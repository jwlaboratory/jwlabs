const markdown = (template) =>
  template
    .toString()
    .replace(/^[\s\S]*?\/\*/, "")
    .replace(/\*\/[\s\S]*$/, "")
    .trim();

window.BLOG_POSTS = [
  {
    slug: "jwllm-part1",
    title: "Making An Inference engine entirely in cpp (jwLLM part 1)",
    date: "2026-09-15",
    category: "Engineering",
    authors: "Shrey Birmiwal",
    noAbstract: true,
    summary: "A semester-long build log about creating a GPT-2 inference engine in Cpp while applying ideas from linear algebra, operating systems, and systems programming.",
    markdown: markdown(() => { /*
# Making An Inference engine entirely in cpp (jwLLM part 1)

# Intro and motivation

This semester I’m taking Linear Algebra, Operating Systems, and Cpp programming at UT Austin. I thought to myself, what better way to reinforce the learnings from the courses than to work on a semester long project that specifically focuses on the stuff I just learned from class?

I landed on building an inference engine in cpp to run GPT-2. Not only is it a super cool and fast growing field that I’m super interested in, It’ll almost perfectly map concepts from class to the project. Some things I’m looking forward to building and learning are:

- Learning how virtual memory works and seeing how we can implement that for KV (vLLM)  
- Learning about matrix ops in lin alg and seeing how things like tensor parallel or efficient matrix mult can be performed  
- Learning about mmap and seeing how we can use it to multiprocessor with fork() and to manage shared KV cache  
- Learning about cache and how we can optimize our code (stride access patterns etc)  
- Learning about CPU scheduling algos and seeing how we can build a scheduler for forward passes and also at macro, the GPU routing algos  
- Learning Cpp tricks and tips and implementing them  
- Learning how data is stored and floating point is represented in memory and seeing how quantization can be built  
- Learning how efficient I/O is built and seeing how we can build things like FlexGen or SSD weight streaming  
- Learning concurrent programming and seeing how we can speed up our inference server  
- Learning networking and seeing how that can be applied to prefill decode disag

One thing I’d like to note: The goal of this project is to learn, not to showcase a project. If I wanted to, most of this could be completed with a LLM very quickly. Instead of focusing on learning, the projects are slow and intentional, so bear with me\!

The code for this project can be found here: [https://github.com/jwlaboratory/jwLLM](https://github.com/jwlaboratory/jwLLM)

# Making it just work

Before we get to do any of the cool optimizations; we must make the engine work (albeit slow\!). Here’s a end demo of what we’ll have running by the end of this blog:

![Caption: jwLLM runs GPT2 at .2 tok/sec on a macbook m4 pro!](/content/jwllm-part1/DEMO.mov?wide-player)

Let’s look at the overall architecture we need to implement to guide us:

![](/content/jwllm-part1/image1.png)

As you can see, it’s a long process, so onwards\! Let’s start with the tokenizer.

## Tokenizer

Let’s trace the data throughout generation, starting with the user request as a string. Since the model can only operate on numbers, we must convert the user query into a list of numbers. It seems trivial but actually was super painful to build. The code for the tokenizer is below, but I want to highlight the codepoint/utf-8/unicode translation and the merge priority system.

```cpp
\#include "tokenizer.hpp"  
\#include "matrix.hpp"  
\#include \<fstream\>  
\#include \<iostream\>  
\#include \<nlohmann/json.hpp\>

using json \= nlohmann::json;

using namespace std;

Tokenizer::Tokenizer(string \_mapping\_json\_path, string \_merge\_txt\_path)  
{  
   ifstream f(\_mapping\_json\_path);  
   if (\!f.is\_open())  
   {  
       throw runtime\_error("could not open mapping");  
   };

   json j;  
   f \>\> j;

   for (auto &\[key, value\] : j.items())  
   {  
       int id \= value.get\<int\>();  
       sToT\[key\] \= id;  
       tToS\[id\] \= key;  
   }  
   f.close();

   // merge list  
   ifstream merge\_f(\_merge\_txt\_path);  
   if (\!merge\_f.is\_open())  
   {  
       throw runtime\_error("could not open merge path");  
   }

   string merge\_line;  
   int cur\_priority \= 0;  
   while (getline(merge\_f, merge\_line))  
   {  
       // Output the text from the file  
       merge\_priority\[merge\_line\] \= cur\_priority;  
       cur\_priority \+= 1;  
   }  
   merge\_f.close();  
   regex\_splitter \= std::regex(R"('s|'t|'re|'ve|'m|'ll|'d| ?\[a-zA-Z\]+| ?\[0-9\]+| ?\[^\\s\\w\]+|\\s+(?\!\\S)|\\s+)");

   // unordered\_map\<int, char32\_t\> byte2unicode\_data;  
   // unordered\_map\<char32\_t, int\> unicode2byte\_data;  
   byte2unicode();  
}

std::vector\<int\> Tokenizer::encode(string in)  
{  
   std::vector\<int\> final\_tokens;

   // 1 apply the regex  
   std::vector\<std::string\> split\_input\_string \= regex\_split(in, regex\_splitter);

   for (std::string chunk : split\_input\_string)  
   {  
       // run per chunk the tokenization

       std::vector\<int\> tokenized\_chunk \= tokenize\_chunk(chunk);

       for (int tokenized\_chunk\_nums : tokenized\_chunk)  
       {  
           final\_tokens.push\_back(tokenized\_chunk\_nums);  
       }  
   }  
   return final\_tokens;  
}

std::vector\<int\> Tokenizer::tokenize\_chunk(std::string chunk)  
{  
   // we should keep a priority queue that keeps the adjacent tokens and the score  
   // \-\> put closest 2 together, lookup  
   // \-\> keep scores : arraypos1, arraypos2  
   // \-\> after loop, merge lowest score, delete extra entry in array or mark it as no longer used (so its skipped)  
   // complete until no more scores

   // struct MergeCandidate  
   // {  
   //     int priority\_score;  
   //     string str;  
   // };

   // vector\<struct MergeCandidate\> all\_candidates;

   // for (int i \= 0; i \< chunk.size() \- 1; i++)  
   // {  
   //     std::string candidate\_as\_string \= chunk\[i\] \+ " " \+ chunk\[i \+ 1\];

   //     int prio;  
   //     if (merge\_priority.find(candidate\_as\_string) \== merge\_priority.end())  
   //     {  
   //         prio \= \-1;  
   //     }  
   //     else  
   //     {  
   //         prio \= merge\_priority\[candidate\_as\_string\];  
   //     }

   //     struct MergeCandidate candidate \= {.priority\_score \= prio, .str \= candidate\_as\_string};  
   //     all\_candidates.push\_back(candidate);  
   // }

   // // main loop  
   // bool finished\_merges \= false;

   // while (\!finished\_merges)  
   // {  
   //     int lowest\_prio \= 9999;  
   //     int lowest\_prio\_index \= \-1;

   //     for (int i \= 0; i \< all\_candidates.size(); i++)  
   //     {  
   //         if (all\_candidates\[i\].priority\_score \!= \-1 && all\_candidates\[i\].priority\_score \< lowest\_prio)  
   //         {  
   //             lowest\_prio \= all\_candidates\[i\].priority\_score;  
   //             lowest\_prio\_index \= i;  
   //         }  
   //     }

   //     // now we want to check  
   //     if (lowest\_prio\_index \== \-1)  
   //     {  
   //         finished\_merges \= true;  
   //         break;  
   //     }  
   //     else  
   //     {  
   //         // here we have at least one merge to make

   //         // case 1: first token  
   //         if (lowest\_prio\_index \== 0\)  
   //         {  
   //             // delete this, update index lowest\_prio\_index+1  
   //             all\_candidates\[lowest\_prio\_index \+ 1\].left\_token\_left\_index \= all\_candidates\[lowest\_prio\_index\].left\_token\_left\_index;  
   //             // reindex

   //             all\_candidates\[lowest\_prio\_index \+ 1\].priority\_score \= new\_prio;

   //             all\_candidates.erase(all\_candidates.begin() \+ lowest\_prio\_index);  
   //         }  
   //         else if (lowest\_prio\_index \== all\_candidates.size() \- 1\)  
   //         {  
   //             // last index case  
   //             all\_candidates\[lowest\_prio\_index \- 1\].right\_index\_right\_index \= all\_candidates\[lowest\_prio\_index\].right\_index\_right\_index;  
   //             all\_candidates.erase(all\_candidates.begin() \+ lowest\_prio\_index);  
   //         }  
   //         else  
   //         {  
   //             // normal case  
   //         }

   //         // \#, \#, \#, \#  
   //         // a, b, c, d  
   //         // a-b, b-c, c-d  
   //         // bc is lowest. then itll be a-bc, bc-d  
   //         // if cd is lowest. then itll be a-b, b-cd  
   //         // if ab is lowest. then itll be ab-c, c-d  
   //     }  
   // }

   // lookup each token

   // return final answ;

   std::vector\<std::string\> symbols;  
   for (size\_t i \= 0; i \< chunk.size(); i\++)  
   {

       unsigned char b \= (unsigned char)chunk\[i\];  
       // unsighend so bytes \> 127 dont break  
       char32\_t cp \= byte2unicode\_data\[b\];  
       // here we get the value correctly, if it was unsafe number, it gets re routed to a safe number  
       // we now gotta make it back into a utf8  
       symbols.push\_back(codepoint\_to\_utf8(cp));  
   }

   while (symbols.size() \> 1)  
   {  
       // find lowest score index  
       int lowest\_index \= \-1;  
       int lowest\_pri \= 9999999;

       for (size\_t i \= 0; i \< symbols.size() \- 1; i\++)  
       {  
           string candidate \= symbols\[i\] \+ " " \+ symbols\[i \+ 1\];

           int prio;  
           if (merge\_priority.find(candidate) \!= merge\_priority.end())  
           {  
               prio \= merge\_priority\[candidate\];  
               if (prio \< lowest\_pri)  
               {  
                   lowest\_pri \= prio;  
                   lowest\_index \= i;  
               }  
           }  
       }

       // if we found smth to merge, lets merge it  
       if (lowest\_index \!= \-1)  
       {  
           symbols\[lowest\_index\] \= symbols\[lowest\_index\] \+ symbols\[lowest\_index \+ 1\];  
           symbols.erase(symbols.begin() \+ lowest\_index \+ 1);  
       }  
       else  
       {  
           // we need to break, no more merges  
           break;  
       }  
   }

   // now we need to get the actual mapped indexes and return them  
   std::vector\<int\> output;

   for (string symb : symbols)  
   {  
       output.push\_back(sToT\[symb\]);  
   }

   return output;  
}

string Tokenizer::decode(std::vector\<int\> in)  
{  
   std::string disguised;

   for (auto &v : in)  
       disguised \+= tToS.at(v);

   std::string raw;  
   size\_t i \= 0;  
   while (i \< disguised.size())  
   {  
       unsigned char b \= disguised\[i\];  
       char32\_t cp;  
       size\_t len;

       if ((b & 0x80) \== 0x00) // 0xxxxxxx → 1 byte  
       {  
           cp \= b;  
           len \= 1;  
       }  
       else // 110xxxxx 10xxxxxx → 2 bytes  
       {  
           cp \= ((b & 0x1F) \<\< 6) | (disguised\[i \+ 1\] & 0x3F);  
           len \= 2;  
       }

       raw \+= (char)unicode2byte\_data\[cp\];  
       i \+= len;  
   }  
   return raw;  
}

// from the internet: function to split into array based on regex  
std::vector\<std::string\> Tokenizer::regex\_split(const std::string &input, const std::regex &re)  
{  
   // Pass 0 instead of \-1 to capture the actual regex matches (tokens)  
   std::sregex\_token\_iterator first{input.begin(), input.end(), re, 0};  
   std::sregex\_token\_iterator last;

   std::vector\<std::string\> tokens;  
   for (auto it \= first; it \!= last; \++it)  
   {  
       if (\!it\-\>str().empty())  
       {  
           tokens.push\_back(\*it);  
       }  
   }  
   return tokens;  
}

void Tokenizer::byte2unicode()  
{

   // these are NORMAL ranges, ie normal characters, and should maintain the same value  
   for (int i \= 33; i \<= 126; \++i)  
   {  
       byte2unicode\_data\[i\] \= i;  
       unicode2byte\_data\[i\] \= i;  
   }  
   for (int i \= 161; i \<= 172; \++i)  
   {  
       byte2unicode\_data\[i\] \= i;  
       unicode2byte\_data\[i\] \= i;  
   }  
   for (int i \= 174; i \<= 255; \++i)  
   {  
       byte2unicode\_data\[i\] \= i;  
       unicode2byte\_data\[i\] \= i;  
   }

   // abnormal ranges  
   int n \= 0;  
   for (int i \= 0; i \< 256; i\++)  
   {  
       if (byte2unicode\_data.find(i) \== byte2unicode\_data.end())  
       {  
           // we have a special case\!  
           byte2unicode\_data\[i\] \= n \+ 256; // we do this to avoid ascii and move it into a safe range  
           unicode2byte\_data\[n \+ 256\] \= i;  
           n\++;  
       }  
   }  
}

// \_chr \= unichr if sys.version\_info\[0\] \== 2 else chr  
// bs \= list(range(ord("\!"), ord("\~")+1))+list(range(ord("¡"), ord("¬")+1))+list(range(ord("®"), ord("ÿ")+1))  
// cs \= bs\[:\]  
// n \= 0  
// for b in range(2\*\*8):  
//     if b not in bs:  
//         bs.append(b)  
//         cs.append(2\*\*8+n)  
//         n \+= 1  
// cs \= \[\_chr(n) for n in cs\]  
// return dict(zip(bs, cs))

// func copied from gpt.  
// itll basically do this. if its a 1 byte, itll keep it. if its a 2byte according to the utf8 pattern (\>)  
// if its 2 byte, itll do the pattern utf8 wants for 2 byte. ie wraps with 11000000 and 10000000  
std::string Tokenizer::codepoint\_to\_utf8(char32\_t cp)  
{  
   std::string out;  
   if (cp \< 0x80)  
   {  
       out \+= (char)cp;  
   }  
   else  
   {  
       out \+= (char)(0xC0 | (cp \>\> 6));  
       out \+= (char)(0x80 | (cp & 0x3F));  
   }  
   return out;  
}

```

### Codepoint Fiasco
Users can type many types of characters, including potentially blank or special characters such as new lines. This can be annoying for debugging with non-visible characters or accidentally outputting these types of characters, so the tokenizer does a unique mapping such that:

1. All input items (emojis, etc) that may take multiple bytes are interpreted on byte at a time  
2. If they (when interpreted as one byte) are “nasty” (new line, white space, etc), they are added 256 to shift into a 2 byte known safe range. For example “ “ becomes “Ġ”.

The result is rather strange. Variable length encoded objects are reinterpreted as one byte, shifted, then reinterpreted. But it works to make all of the characters deterministically mapped to 256 options that are safe.   
### Merges
Each character, though has a token id mapping, is not well interpreted by the model. That's like a human trying to read characters by characters instead of words by words. So the tokenizer then merges the pairs of the most frequent subtokens repeatedly. Here’s an example:

| S | U | B | M | A | R | I | N | E |
| :---- | :---- | :---- | :---- | :---- | :---- | :---- | :---- | :---- |
| 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |

You can see SUBMARINE with each character mapping to a token ID. Let’s perform the merges (which merge in the *order of priority given)*.

Merge priorities (given, trained by frequencies in training set)

| Tok 1 | Tok 2 | Merge Priority |
| :---- | :---- | :---- |
| S | U | 1 |
| SU | B | 2 |
| U | B | 3 |
| M | A | 4 |
| R | I | 5 |
| I | N | 6 |
| RI | N | 7 |
| RIN | E | 8 |
| MA | RINE | 9 |

The tokenizer will repeatedly merge the top priority that exists in the given list of tokens.  
In this case, it’ll merge S-U, then SU-B, then M-A, then R-I, then RI-N, then RIN-E, then MA-RINE. Notice it skips U-B and I-N and never merges SUB-MARINE.

This is cool because it learns the most frequent merges and therefore can split where semantic meaning is most helpful. In this case, the submarine split clearly into sub (which means under) and marine (which means water). It allows the model to still understand, even if it's never seen a submarine, that the word represents under-water.

## Embedding

```cpp
\#include "matrix.hpp"  
\#include "embedding.hpp"  
using namespace std;

Embedding::Embedding(SafeTensors &weights)  
{  
   WORD\_TOKEN\_EMBEDDING \= weights.get("wte.weight");  
   WORD\_POSITIONAL\_EMBEDDING \= weights.get("wpe.weight");  
}

Matrix Embedding::tokenized\_to\_embed(const std::vector\<int\> &token\_ids)  
{  
   // token\_ids is a single sequence of vocab ids  
   int d\_model \= WORD\_TOKEN\_EMBEDDING.cols;  
   int seq\_len \= token\_ids.size();  
   std::vector\<float\> out(seq\_len \* d\_model);

   for (int i \= 0; i \< seq\_len; i\++)  
   {  
       int token\_id \= token\_ids\[i\];

       for (int g \= 0; g \< d\_model; g\++)  
       {  
           out\[i \* d\_model \+ g\] \= WORD\_TOKEN\_EMBEDDING.data\[token\_id \* d\_model \+ g\];  
           // out is flat array, word\_token embedding is also flat array  
       }  
   }

   return Matrix(seq\_len, d\_model, out);  
}

void Embedding::apply\_positional\_encoding(Matrix &token\_embeddings)  
{  
   // seq len rows  
   // dmodel cols

   // WORD\_POSITIONAL\_EMBEDDING is a table of size: position rows, dmodel cols

   int seq\_len \= token\_embeddings.rows;  
   int dmodel \= token\_embeddings.cols;

   for (int i \= 0; i \< seq\_len; i\++)  
   {  
       for (int g \= 0; g \< token\_embeddings.cols; g\++)  
       {  
           token\_embeddings.data\[i \* dmodel \+ g\] \+= WORD\_POSITIONAL\_EMBEDDING.data\[i \* dmodel \+ g\];  
       }  
   }  
}

```

Our tokenizer gave us a vector of numbers representing the IDs of each token. Next we need to convert into embeddings such that something that will give us rich features of each token. The dimensions of this is called dmodel. We do this by looking up in a table for our token ID. 

The embeddings tell the model the meaning of each token, but it tells the model nothing about the position of each token. For example, if the word yellow appears at the start and at the end of the sentence, this looks identical to the model. So next we apply an addition of a positional vector, unique per position but the same for all tokens, that internally uses sine and cosine to be rotatory in nature to represent the location of each word.

Now we have a [sequence x d_model] representation that contains information about the tokens, the meaning, and the location of each token.

### The attention block

Next, this [sequence x d_model] representing the token goes through 12 back to back attention blocks. Let’s look at what this is:

![](/content/jwllm-part1/image2.png)

You’ll see the at each stage the dimensions remain the same (even though they may be internally transformed) from [seq, model]. You’ll also see this residual that keeps the original value summated throughout like a loop. Let’s dive into each piece we composed in this picture next.

### Layer Norm

LayerNorm’s goal is to make all the data per row be standardized. It does this by normalizing each row to mean = 0, variance = 1, then scaling by gamma and shifting by beta. Eps is added to the denominator when making the variance zero to prevent dividing by zero. What helped me understand this part was remembering the Z-Score formula from high school stats.

```cpp
// normalize each row to mean 0 / variance 1, then scale by gamma and shift by beta  
Matrix Matrix::layernorm(const Matrix &gamma, const Matrix &beta, float eps) const  
{

   vector\<float\> out(this\-\>data.size());

   for (int i \= 0; i \< this\-\>rows; i\++)  
   {

       // for each row  
       float mean \= 0;  
       for (int g \= 0; g \< this\-\>cols; g\++)  
       {  
           mean \+= this\-\>data\[i \* this\-\>cols \+ g\];  
       }  
       mean /= this\-\>cols;

       float var \= 0;  
       for (int g \= 0; g \< this\-\>cols; g\++)  
       {  
           float diff \= this\-\>data\[i \* this\-\>cols \+ g\] \- mean;  
           var \+= diff \* diff;  
       }  
       var /= this\-\>cols;  
       // vaiance is difference^2) averaged out  
       // variance is sigma (standard deviation squared)

       // z sciore \- (x-u)/sigma  
       // we basically calcualting this

       // eps to pevent divide by zero

       for (int g \= 0; g \< this\-\>cols; g\++)  
       {  
           out\[i \* this\-\>cols \+ g\] \= (this\-\>data\[i \* this\-\>cols \+ g\] \- mean) / std::sqrt(var \+ eps);  
       }  
   }

   // beta and gamma are learned so model decides what to expand. gamma is sscaler, beta is additive. //eps is to prevent divide by zero  
   Matrix out\_m \= Matrix(this\-\>rows, this\-\>cols, out);  
   return (out\_m.broadcast\_multiply\_row(gamma)).broadcast\_add\_row(beta);  
}

```

We run this layernorm constantly throughout the model, notably before each attention block.

### Attention

Attention is the key work that makes this whole language model work. We first create Q, K, V, split by head, then do the self attention equation over each head, then finally concat.

I’m going to defer to a better source to explain the meaning and how this works internally. What really helped me was the video by Umar Jamil on transformers, found here: [https://www.youtube.com/watch?v=ISNdQcPhsts](https://www.youtube.com/watch?v=ISNdQcPhsts) and [https://www.youtube.com/watch?v=bCz4OMemCcA](https://www.youtube.com/watch?v=bCz4OMemCcA)

```cpp
Matrix Attention::forward(const Matrix &x)  
{  
   // lets create k, q, v  
   // fused multiplication intuition

   // x= 3x10 (3 seq len, dmodel=10)  
   // fused \= 10x10 but 3 stacked HORiZONTALLY, so its 10x30

   // output 10x30  
   // Q \= Y\[:, 0:10\] K \= Y\[:, 10:20\] V \= Y\[:, 20:30\]  
   Matrix FusedQKV \= (x.multiply(ATTENTION\_WEIGHTS)).broadcast\_add\_row(ATTENTION\_BIAS);

   Matrix Q \= FusedQKV.slice\_cols(0, dmodel);  
   Matrix K \= FusedQKV.slice\_cols(dmodel, dmodel);  
   Matrix V \= FusedQKV.slice\_cols(dmodel \* 2, dmodel);  
   // shape is \[seqlen, d\_model\]

   // now, we need to do spliting  
   int d\_head \= dmodel / heads;

   // say we have 4 heads and dmodel of 16  
   // 0-4, 4-8, 8-12, 12-16  
   // 0,   1,   2,    3  
   Matrix output;  
   for (int h \= 0; h \< heads; h\++)  
   {  
       Matrix q\_head \= Q.slice\_cols(h \* d\_head, d\_head);  
       Matrix k\_head \= K.slice\_cols(h \* d\_head, d\_head);  
       Matrix v\_head \= V.slice\_cols(h \* d\_head, d\_head);  
       // shape is \[seq, dhead\]

       // transpose k  
       Matrix k\_t \= k\_head.transpose(); //\[dhead, seq\]

       Matrix Q\_kt \= q\_head.multiply(k\_t); //\[seq, seq\]  
       // tells us how much each entry in x relates to x, in that zone of embedding focus

       // divide by the sqrt d\_k  
       Matrix pre\_mask \= Q\_kt.multiply\_scalar(1 / std::sqrt(d\_head));  
       Matrix masked \= pre\_mask.mask\_causal();  
       Matrix softmaxed \= masked.softmax\_rows(); // still \[seq, seq\]

       Matrix post\_v \= softmaxed.multiply(v\_head);  
       // \[seq,seq\] \* \[seq, dhead\]  
       // now back to \[seq, dhead\]

       // append  
       if (h \== 0)  
           output \= post\_v;

       else  
           output \= output.concat\_cols(post\_v);  
   }

   // do the projections  
   return output.multiply(PROJECTION\_WEIGHTS).broadcast\_add\_row(PROJECTION\_BIAS);  
   //\[seq, dmodel\]  
}
```

I’ve also included the key code for the matrix helpers (slice\_cols, concat\_cols, and softmax) below, but they are pretty self explanatory.

```cpp
Matrix Matrix::multiply(const Matrix &other) const  
{  
   // check dims  
   if (cols \!= other.rows)  
       throw std::invalid\_argument("dims dont match");

   // do actual multiplication  
   std::vector\<float\> out(rows \* other.cols);

   for (int i \= 0; i \< this\-\>rows; i\++)  
   {  
       // for each row

       for (int q \= 0; q \< other.cols; q\++)  
       {  
           // each col of the other now  
           float sum \= 0;  
           for (int g \= 0; g \< this\-\>cols; g\++)  
           {  
               sum \+= this\-\>data\[i \* this\-\>cols \+ g\] \* other.data\[g \* other.cols \+ q\];  
           }

           out\[i \* other.cols \+ q\] \= sum;  
       }  
   }

   return Matrix(rows, other.cols, out);  
}

Matrix Matrix::addition(const Matrix &other) const  
{  
   // check dims  
   if (cols \!= other.cols || rows \!= other.rows)  
       throw std::invalid\_argument("dims dont match");

   // do actual addition  
   std::vector\<float\> out(data.size());  
   for (int i \= 0; i \< data.size(); i\++)  
   {  
       out\[i\] \= this\-\>data\[i\] \+ other.data\[i\];  
   }

   return Matrix(rows, cols, out);  
}

Matrix Matrix::transpose() const  
{  
   // we store row x col  
   // we need to swap to col x row

   // ie transpose:  
   // \[a,b,c,d,e,f\]  
   // 2x3 \--\> 3x2  
   //\[a, d, b, e, c, f\]

   // 0,1 \--\> 1,0  
   //

   vector\<float\> out(this\-\>data.size());  
   for (int i \= 0; i \< this\-\>rows; i\++)  
   {  
       for (int g \= 0; g \< this\-\>cols; g\++)  
       {  
           int newRow \= g;  
           int newCol \= i;  
           int total\_per\_row\_new \= this\-\>rows;

           out\[newRow \* total\_per\_row\_new \+ newCol\] \= this\-\>data\[i \* this\-\>cols \+ g\];  
       }  
   }  
   return Matrix(this\-\>cols, this\-\>rows, out);  
}

Matrix Matrix::multiply\_scalar(float scalar) const  
{  
   vector\<float\> out(this\-\>data.size());  
   for (int i \= 0; i \< this\-\>data.size(); i\++)  
   {  
       out\[i\] \= this\-\>data\[i\] \* scalar;  
   }  
   return Matrix(this\-\>rows, this\-\>cols, out);  
}

Matrix Matrix::gelu() const  
{  
   vector\<float\> out(this\-\>data.size());  
   for (int i \= 0; i \< this\-\>data.size(); i\++)  
   {  
       float x \= this\-\>data\[i\];  
       out\[i\] \= 0.5f \* x \* (1.0f \+ std::tanh(0.7978845608f \* (x \+ 0.044715f \* x \* x \* x)));  
   }  
   return Matrix(this\-\>rows, this\-\>cols, out);  
}

Matrix Matrix::broadcast\_add\_row(const Matrix &row) const  
{  
   // we have a matrix \[seqlen x dmodel\]  
   // we want to add a bias of size \[dmodel\]  
   // we broadcast so this adds to each row

   if (row.rows \!= 1 || this\-\>cols \!= row.cols)  
   {  
       throw std::invalid\_argument("to broadcast add, must be row size \=1");  
   }

   vector\<float\> out(this\-\>data.size());

   for (int i \= 0; i \< this\-\>rows; i\++)  
   {  
       for (int g \= 0; g \< this\-\>cols; g\++)  
       {  
           out\[i \* this\-\>cols \+ g\] \= this\-\>data\[i \* this\-\>cols \+ g\] \+ row.data\[g\];  
       }  
   }  
   return Matrix(this\-\>rows, this\-\>cols, out);  
}

Matrix Matrix::broadcast\_multiply\_row(const Matrix &row) const  
{  
   if (row.rows \!= 1 || this\-\>cols \!= row.cols)  
   {  
       throw std::invalid\_argument("to broadcast add, must be row size \=1");  
   }

   vector\<float\> out(this\-\>data.size());

   for (int i \= 0; i \< this\-\>rows; i\++)  
   {  
       for (int g \= 0; g \< this\-\>cols; g\++)  
       {  
           out\[i \* this\-\>cols \+ g\] \= this\-\>data\[i \* this\-\>cols \+ g\] \* row.data\[g\];  
       }  
   }  
   return Matrix(this\-\>rows, this\-\>cols, out);  
}

Matrix Matrix::softmax\_rows() const  
{

   vector\<float\> out(this\-\>data.size());

   // loop 0: for each row  
   for (int row \= 0; row \< this\-\>rows; row\++)  
   {

       // loop one: find max val in the row  
       float max \= this\-\>data\[row \* this\-\>cols \+ 0\];  
       for (int g \= 0; g \< this\-\>cols; g\++)  
       {  
           if (this\-\>data\[row \* this\-\>cols \+ g\] \> max)  
           {  
               max \= this\-\>data\[row \* this\-\>cols \+ g\];  
           }  
       }

       // loop 2: calc sum and set each index to the e^(si-max)  
       float sum\_of\_all \= 0;  
       for (int g \= 0; g \< this\-\>cols; g\++)  
       {  
           out\[row \* this\-\>cols \+ g\] \= std::exp(this\-\>data\[row \* this\-\>cols \+ g\] \- max);  
           sum\_of\_all \+= out\[row \* this\-\>cols \+ g\];  
       }

       // loop 3: divide all by sum  
       for (int g \= 0; g \< this\-\>cols; g\++)  
       {  
           out\[row \* this\-\>cols \+ g\] /= sum\_of\_all;  
       }  
   }

   return Matrix(this\-\>rows, this\-\>cols, out);  
}

// given a matrix, give the data in col start, start+1, start+2... start+len  
Matrix Matrix::slice\_cols(int start, int len) const  
{  
   if (start \< 0 || len \<= 0 || start \+ len \> this\-\>cols)  
       throw std::invalid\_argument("slice out of range");

   vector\<float\> out(this\-\>rows \* len);  
   int index \= 0;  
   for (int i \= 0; i \< this\-\>rows; i\++)  
   {  
       for (int g \= 0; g \< this\-\>cols; g\++)  
       {  
           if (start \<= g && g \< start \+ len)  
           {  
               out\[index\] \= this\-\>data\[i \* this\-\>cols \+ g\];  
               index\++;  
           }  
       }  
   }  
   return Matrix(this\-\>rows, len, out);  
}

Matrix Matrix::concat\_cols(const Matrix &other) const  
{

   if (other.rows \!= this\-\>rows)  
   {  
       throw std::invalid\_argument("got to have same rows for concat");  
   }

   vector\<float\> out(this\-\>data.size() \+ other.data.size());  
   int max\_len \= this\-\>cols \+ other.cols;

   for (int i \= 0; i \< this\-\>rows; i\++)  
   {  
       for (int g \= 0; g \< max\_len; g\++)  
       {  
           if (g \< this\-\>cols)  
           {  
               out\[i \* max\_len \+ g\] \= this\-\>data\[i \* this\-\>cols \+ g\];  
           }  
           else  
           {  
               out\[i \* max\_len \+ g\] \= other.data\[i \* other.cols \+ g \- this\-\>cols\];  
           }  
       }  
   }  
   return Matrix(this\-\>rows, max\_len, out);  
}  
// normalize each row to mean 0 / variance 1, then scale by gamma and shift by beta  
Matrix Matrix::layernorm(const Matrix &gamma, const Matrix &beta, float eps) const  
{

   vector\<float\> out(this\-\>data.size());

   for (int i \= 0; i \< this\-\>rows; i\++)  
   {

       // for each row  
       float mean \= 0;  
       for (int g \= 0; g \< this\-\>cols; g\++)  
       {  
           mean \+= this\-\>data\[i \* this\-\>cols \+ g\];  
       }  
       mean /= this\-\>cols;

       float var \= 0;  
       for (int g \= 0; g \< this\-\>cols; g\++)  
       {  
           float diff \= this\-\>data\[i \* this\-\>cols \+ g\] \- mean;  
           var \+= diff \* diff;  
       }  
       var /= this\-\>cols;  
       // vaiance is difference^2) averaged out  
       // variance is sigma (standard deviation squared)

       // z sciore \- (x-u)/sigma  
       // we basically calcualting this

       // eps to pevent divide by zero

       for (int g \= 0; g \< this\-\>cols; g\++)  
       {  
           out\[i \* this\-\>cols \+ g\] \= (this\-\>data\[i \* this\-\>cols \+ g\] \- mean) / std::sqrt(var \+ eps);  
       }  
   }

   // beta and gamma are learned so model decides what to expand. gamma is sscaler, beta is additive. //eps is to prevent divide by zero  
   Matrix out\_m \= Matrix(this\-\>rows, this\-\>cols, out);  
   return (out\_m.broadcast\_multiply\_row(gamma)).broadcast\_add\_row(beta);  
}

Matrix Matrix::mask\_causal(float big\_negative) const  
{  
   vector\<float\> out(this\-\>data.size());

   if (this\-\>rows \!= this\-\>cols)  
   {  
       throw std::invalid\_argument("must be a square matrix");  
   }

   for (int i \= 0; i \< this\-\>rows; i\++)  
   {  
       for (int g \= 0; g \< this\-\>cols; g\++)  
       {

           if (g \> i)  
               out\[i \* this\-\>cols \+ g\] \= big\_negative;  
           else  
               out\[i \* this\-\>cols \+ g\] \= this\-\>data\[i \* this\-\>cols \+ g\];  
       }  
   }  
   return Matrix(this\-\>rows, this\-\>cols, out);  
}
```

### MLP

The MLP (multi layer perceptron) is the next part in the transformer block. People commonly think the transformer is all the weights of the model, but in reality this part contains a huge amount of the compute and weights.

The MLP takes the incoming data, projects into a higher dimensionality, applies a non linearity, then projects back into the small space.

What made me understand this was thinking about how low rank factorization worked ([which I wrote about here](https://jwlabs.vercel.app/post/sparklingtree)), and how this inverses it to get better (instead of less) control of how data can be separated.

```cpp
\#include "mlp.hpp"  
\#include \<stdexcept\>

MLP::MLP(SafeTensors &weights, const std::string &prefix)  
{  
   FC\_WEIGHTS \= weights.get(prefix \+ "mlp.c\_fc.weight");  
   FC\_BIAS \= weights.get(prefix \+ "mlp.c\_fc.bias");  
   PROJECTION\_WEIGHTS \= weights.get(prefix \+ "mlp.c\_proj.weight");  
   PROJECTION\_BIAS \= weights.get(prefix \+ "mlp.c\_proj.bias");  
}

Matrix MLP::forward(const Matrix &x) const  
{  
   //\[seq, dmodel\]

   // same idea as  low rank facotirzation But INVERSED. we project into big zone so we can seperate, then project done  
   Matrix widened \= x.multiply(FC\_WEIGHTS).broadcast\_add\_row(FC\_BIAS);

   widened \= widened.gelu();

   Matrix shrunk \= widened.multiply(PROJECTION\_WEIGHTS).broadcast\_add\_row(PROJECTION\_BIAS);

   return shrunk;

   // note. a LOT OF THE PARAMS live here. this is a HEAVY spot, very important  
   // without non linearity this would be waste of time  
}

```

### Convert to logits, sample, and decode

The final part\! We need to take this [seq, d_model] and turn it into something that is useful, the next token\!

Recall at the start we indexed the tokid:embedding table. Now, we multiply by the transpose of the embedding table [dmodel, vocab], to get a table that shows [seq, vocab]. The last row tells us the scores of each vocab[i] position! 

We sample from this (you can use things like temperature, top-p, nucleus, etc) but in this simple case we use argmax to get the top score and greedily decode it. We convert it back to a string and output it.

```cpp
Matrix GPT::forward(const std::vector\<int\> &token\_ids)  
{  
   if (token\_ids.empty())  
   {  
       throw std::invalid\_argument("forward needs at least one token");  
   }

   // \[seq, dmodel\]  
   Matrix x \= embedding.tokenized\_to\_embed(token\_ids);  
   embedding.apply\_positional\_encoding(x);

   for (TransformerBlock &block : blocks)  
   {  
       x \= block.forward(x);  
   }

   x \= x.layernorm(LN\_F\_WEIGHT, LN\_F\_BIAS);  
   return x.multiply(WTE\_T); // back to vocab size  
}

int GPT::next\_token(const std::vector\<int\> &token\_ids)  
{  
   Matrix logits \= forward(token\_ids);

   // arg max for now  
   int last \= (logits.rows \- 1) \* logits.cols;  
   int best \= 0;  
   for (int j \= 1; j \< logits.cols; j\++)  
   {  
       if (logits.data\[last \+ j\] \> logits.data\[last \+ best\])  
       {  
           best \= j;  
       }  
   }  
   return best;  
}

std::vector\<int\> GPT::generate(std::vector\<int\> token\_ids, int max\_new)  
{  
   for (int i \= 0; i \< max\_new; i\++)  
   {  
       if ((int)token\_ids.size() \>= MAX\_POSITIONS)  
       {  
           break;  
       }  
       int next \= next\_token(token\_ids);  
       if (next \== EOT\_TOKEN)  
       {  
           break;  
       }  
       token\_ids.push\_back(next);  
   }  
   return token\_ids;  
}
```

# Fin

Obviously a lot of optimizations can be built next, which is exactly what we will be doing next\! Stay peeled to watch for the next blog in this series.
*/ }),
  },
  {
    slug: "computer-use-interrupts",
    title: "Making computer-use models faster with interrupts instead of polling",
    date: "2026-09-14",
    category: "Engineering",
    authors: "Shrey Birmiwal",
    summary: "A proof of concept for replacing expensive computer-use polling loops with a tiny local watcher model that detects when an application is ready and interrupts the main model.",
    markdown: markdown(() => { /*
# Making computer-use models faster with interrupts instead of polling

**TL;DR:** I trained a tiny model that runs very fast loops on your device to “interrupt” the main computer-use model when a page or application it is waiting for has loaded.

## The polling problem

Computer use is a newer way of using large language models. Instead of using a chatbot window to interact with LLMs, computer use gives your model control of your mouse and keyboard to complete tasks for you. It typically works like this:

![A handwritten diagram showing the computer-use loop from screenshot and HTML reading to reasoning, acting with the keyboard and mouse, and observing again](/content/computer-use-interrupts/agent-loop.png?no-caption)

Sometimes you may encounter a page or application that requires waiting, for example, waiting for a video to buffer or a webpage to load. If the website is programmed nicely (and likely simply!), you can repeatedly read its HTML until the button or part of the page that you need has loaded.

If the site is programmed as an application or inside a canvas as dynamic content, the problem gets more involved. You have to take a screenshot, process it, check whether the part of the page you need has loaded, and, if it has not, decide when to check again.

Here’s an example of what I mean. This recording uses Claude, but the issue applies to Perplexity, Codex, and other computer-use systems (and it is a real annoyance I have noticed).

![Claude repeatedly polling and sleeping to check whether a page has loaded](/content/computer-use-interrupts/polling-demo.mp4?wide-player)

1. Claude takes a screenshot, processes it, and realizes the page has not loaded yet.
2. Claude decides to sleep for five seconds and check again.
3. Claude takes **another screenshot** and realizes the page still has not loaded.
4. Claude decides to sleep for **another ten seconds** and check again.
5. The loop continues until the page is ready.

Eventually, the page loads and Claude gets the data it needs. However, this wastes resources in several ways.

First, polling wastes time because the page can load between checks. If Claude polls every ten seconds and the page loads at the 13-second mark, it waits another seven seconds before noticing.

![A page loading between polling checks leaves delay](/content/computer-use-interrupts/polling-delay.png)

Second, it muddies the context and plan. Repeatedly thinking about “is the page loaded yet?” can make the model lose track of why it needed to read the page in the first place.

Third, it wastes tokens. In the example above, Claude took three screenshots. At Standard HD, that is approximately 1,600 tokens, or about $0.014 in total.

## Using Interrupts instead of polling

This problem reminded me of a concept from operating systems that we learned in UT Austin’s CS 439 course: interrupts and polling. When the CPU is waiting for a task to complete, ie, reading from I/O: it can either poll or wait for an interrupt.

| Polling | Interrupt |
| :---- | :---- |
| The CPU constantly asks, in a loop, “is the job done?” | The CPU sits idle (or does another task) until an electrical signal wakes it when the task completes. |
| A short loop delay notices completion faster; a long delay adds latency. | Knows quickly. |
| A short delay uses more resources; a long delay uses fewer. Either way, the CPU stays busy polling. | Does not keep the CPU busy. |

In this case, we can see the analogy between Claude “polling” to see if the page has loaded and the CPU polling for task completion.

It’s not possible to send an electric signal to wake up Claude when the webpage has loaded because we are dealing with many types of applications and pages that may not play nice with us asking them to wake us up.

However, we can still apply this idea of an interrupt. By using a tiny model (much faster, much cheaper, that can run very very fast loops for free on device) to constantly monitor the webpage.

Because this model’s job is not to think, understand english and other languages, reason about keyboards and mouse, or know how a variety of webpages look; but solely to check or at least make a good guess if the application has reached the next state, it can be much smaller in parameter count.

When this tiny model polls and determines the page has reached the next state, it can ping the large, main model (similar to an interrupt).

![The main model calls the tiny model to poll for it rapidly and interrupt when loaded](/content/computer-use-interrupts/interrupt-flow.png)

This keeps the big model away from spending tokens and time on checking things like if the page has loaded.

## Training a tiny "BRR" model and MCP for Claude-in-Chrome

I trained a tiny CNN in NumPy with only 9,000 parameters and about 40 KB of weights. It trained in under a minute on my MacBook and classifies a frame as **loaded** or **pending** in a few milliseconds, so it could potentially run hundreds of checks per second and deliver subsecond interrupts.

Obviously, this was not trained on internet scale data, so does not generalize at all outside of the 5 demo HTML webpages that I trained this on. However, I believe this shows that easily a <1 million parameter model that can run in milliseconds can detect if a page has loaded with a high accuracy across many domains (apps, webpages, videos, etc).

I also quickly vibe coded a quick MCP that would expose this as a tool to Claude in chrome. Here's a demo of the project in action. As you can see, the main model does not process screenshots to poll and is much faster, and cheaper. Almost as soon as the web page loaded, the tiny model returns, and claude begins it's next action almost instant

![Demo of the tiny model interrupting Claude when the web page loads](/content/computer-use-interrupts/brr-cua-demo.mov?no-caption)

GitHub: [jwlaboratory/brr-cua](https://github.com/jwlaboratory/brr-cua)

Thanks for reading! This is just a proof of an idea, but I think it is viable. As computer use becomes a bigger part of the knowledge work that LLMs can help with, it would be very cool to see companies like Perplexity or Codex use something similar in their computer-use systems.
*/ }),
  },
  {
    slug: "will-ai-be-the-dj",
    title: "DJing a club with an AI agent",
    date: "2026-09-11",
    category: "Side Quests",
    authors: "Shrey Birmiwal",
    noAbstract: true,
    summary: "The DJ used to work behind the booth; now the DJ is the show. As AI comes for art and music, I don't think it comes for the DJ, because DJing is a social event, not just a technical one. So I tried to build one anyway: an agent that controls real DJ software over text and mixes songs on its own.",
    markdown: markdown(() => { /*
# DJing a club with an AI agent

In the past year, I've gotten the wonderful opportunity to learn how to DJ music, fell in love with it, and gotten the opportunity to DJ many big parties and clubs in multiple parts of the United States ([shrekevents.vercel.app](https://shrekevents.vercel.app)). Recently, seeing how music, art, image, and video are changing with AI, I wonder how creativity will change in a post-AGI world. I think it's interesting and important to debate the place of AI in the arts and speculate on the future of this field. But first, let's step back into the history of DJing.

## A History of DJing

### The unknown DJ

The role of the DJ, previously known as a disc jockey, was to take discs and seemingly transition between these discs as to not kill the energy and keep people dancing. Since no need existed for the DJ to be present, DJs were commonly actually hidden away, with only a small one-way window to see the crowd. The focus was on the dancing and connecting with each other on the dance floor, not looking at the DJ.

At this time, it was very easy to point to DJing and call it an art. You needed to use your ears, which had been trained over hundreds of hours. You had to use style in picking your songs, and you had to use the touch in the hands to decide what ways to move the actual discs. Each DJ had their own unique style and way of performing. So very clearly, we could point to this and call it an art.

### The performing DJ

As time evolved, the DJ became more and more of a performer. The DJ became the centerpiece, what you would look at, and the entire crowd was facing the DJ as if it's a performance rather than something to set the mood to dance. Transitions became more flashy and technical, as the role of the DJ was to perform and not just to keep people moving. Take for example Tiesto in 2003 with his iconic performance, where he is clearly the center of focus.

https://www.youtube.com/watch?v=EBlyssO7gyc

My guess for why this shift happened was because of the advent of technology, people being able to share their experiences, which would have a longer impact than to share experiences in the moment with a friend. For example, being able to tell others that you attended this famous Tiesto concert would have a longer and higher aura gain than experiencing it in person with just the dancing with a friend. I think this has only shifted even more, now we have social media where it's almost essential to post every concert you go to or every event you attend because the legacy and the aura gained from attending an event far outweighs being present. I'm not critiquing this, as I'm a victim myself, but just sharing some guesses on what happened in this phase.

### The hobby DJ

Today, technology has advanced and tools such as Rekordbox, which have become the industry standard for DJing, have pretty much completed all of the hard work that we previously used to define DJing as an art. For example, beat matching, which used to be done by ear and required hours of training, can now be done with a simple sync button. Effects no longer require jittery hand movements such as scratching and instead can be done with a button click. Songs can be loaded from Spotify, crossfaded, and vocals can be completely isolated. Whether we can still call this an art is an interesting question.

Below is a picture of a record box. You can see the amount of tech that has been included, which makes, some could say, the job of DJing very simple.

![](/content/will-ai-be-the-dj/rekordbox-sync.png)

## My take

I first started DJing after I went to my first few freshman year fraternity parties. It's because I noticed something very simple. The DJs at these events were very good. They knew what they were doing; they knew and used every button on the decks.

But they were just playing songs that I didn't want to hear. They were playing songs that were very EDM and very overly edited remixes of popular songs. In my eyes, all I wanted to hear was Katy Perry and hear old songs that I knew all the words to that I could sing and dance my heart out to. For some reason, it seemed like the DJs were afraid of playing the simple songs because they didn't want to seem like they didn't have a job to do. So they wanted to make it seem as complex as possible by playing remixes and doing fancy edits.

It made sense to me, and even though everyone said that "the DJs are good" I knew secretly they would just prefer a Spotify jam with their favorite songs.

So I decided to become the DJ myself. My first party I DJ'd, I basically just played songs out till completion and started the next song right after: no effects, transitions, or loops at all. Many people came up to me and told me I was the best DJ they had ever listened to. It was crazy to me that people genuinely did not notice that I did little to no transitions, but it made sense: when's the last time you judged a DJ based on the transitions (unless it's horrendous)? Almost always, you'll tell your friends, "that music was so good, it was all my favorite songs."

It's clear to me song selection and reading the vibe is the real art. Some people have this art. Some people don't, and I know this because song reqs sometimes aren't what will satisfy the vibe. Transitions were never the art in question in my eyes.

I think no matter what, DJing will always remain as a job. It's my backup career plan. Even if AI can do the transitions perfectly, it'll never have that secret intuition about what songs to play. When I DJ, I really look at people and try to imagine how they feel. What song will make them scream and let loose next? When I see the twinkle in the eyes of the people in the back I know I should let out a song they love and when they are looking lost I know to play a song that they'll (ironically) think (wow this is a great DJ) (this is actually counterintuitive: sometimes you want to play songs that make you seem like a good DJ, because the people themselves don't even know they want to hear the songs they really want to hear and think they are here for a performance, for their Instagram).

## But can AI actually DJ?

Even if AI isn't going to replace the DJ as a social role, could it actually do the job? Could an AI control real DJ software and mix songs on its own?

I started by testing out GPT-6 Astra, because I'd seen it controlling desktops, playing music on digital pianos ([demo](https://www.linkedin.com/posts/oskar-neumann_yes-computer-use-with-gpt-6-astra-is-this-ugcPost-7501783660652679169-n-UY/)), and generally operating software the same way a person would, just by being told what to do in plain language.

However, mixing isn't as simple, because it requires reading and moving waveforms, which requires listening, and constantly rebalancing the EQs of two tracks fighting over the same frequencies. So it requires some judgment calls, and also constant screenshots to be able to understand and keep up to date with the latest state.

So instead of trying to get the computer-use model to work, I instead made a thin wrapper over the DJ software to create a text format that the model could actually ingest, and gave it tools in order to control the software.

Code: [github.com/shreybirmiwal/dj](https://github.com/shreybirmiwal/dj)

From there I just experimented and gave the agent more tools to basically keep on improving. Added features like loop-aware, phrasing-aware, lyrics-aware, and features like echo, reverb, highs, lows, mids, and stems access.

I was actually very surprised by the quality. Here are some of the mixes it's created, which are genuinely very, very good in my opinion.

```djmix
[
  {"title": "Waiting for Tonight × Ion Trust a Soul", "sub": "Jennifer Lopez × Disco Lines", "src": "/content/will-ai-be-the-dj/mix-01.mp3", "duration": 76},
  {"title": "Love Story × Levels", "sub": "Taylor Swift × Avicii", "src": "/content/will-ai-be-the-dj/mix-02.mp3", "duration": 81},
  {"title": "Dynamite × Die Young", "sub": "Taio Cruz × Kesha", "src": "/content/will-ai-be-the-dj/mix-03.mp3", "duration": 80},
  {"title": "Party on My Mind × Only Girl (In the World)", "sub": "Hindi pop × Rihanna, multilingual mix", "src": "/content/will-ai-be-the-dj/mix-04.mp3", "duration": 79}
]
```

Of course, there's still gaps in making them perfect, maybe adding more variation, more tools. But I think this clearly shows that perfecting an actual transition may not be the art, and it could be completed by a computer, deterministically.

## Taking it to a real club

But does this actually work? So I tested this out by playing a little bit of my set at 6th Street at Poor Choices using this AI model.

![](/content/will-ai-be-the-dj/club-clip.mp4?player)

*(Yes, I still brought my controller and Rekordbox to take over from the AI when needed, and yes, the AI isn't perfect, but it clearly shows potential.)*

I didn't tell anybody, but people still danced exactly like they would to any other set. And to me, this makes me think, do people really care about the DJ? Or just the social experience that they're looking at somebody and they have a DJ present? Is my job as a DJ solely to pick the songs and control the vibe?

This was a really really fun experiment. I hope you had as much fun reading it as I had building and trying this out.
*/ }),
  },
  {
    slug: "specialization-is-all-speculation-needs",
    title: "Specialization is (sometimes) all Speculation needs",
    date: "2026-07-23",
    category: "Research",
    status: "In Progress",
    authors: "Shrey Birmiwal and Anish Bhat",
    summary: "We improved speculative decoding by up to 46% in acceptance rate on out-of-distribution languages, which translated to up to a 15.3% wall-clock speedup on those languages (and up to 7.3% on aggregate), by specializing block diffusion drafter models using LoRA. However, we find languages have low levels of interference and a single combined LoRA captures almost all of the gains. We next hypothesize specialization will perform better in more fine-grained domains (future work) and has room to bring significant speedups.",
    markdown: markdown(() => { /*
# Specialization is (sometimes) all Speculation needs

**TLDR:** We improved speculative decoding by up to 46% in acceptance rate on out-of-distribution languages, which translated to up to a 15.3% wall-clock speedup on those languages (and up to 7.3% on aggregate), by specializing block diffusion drafter models using LoRA. However, we find languages have low levels of interference and a single combined LoRA captures almost all of the gains. We next hypothesize specialization will perform better in more fine-grained domains (future work) and has room to bring significant speedups.

GitHub: [jwlaboratory/SpecSpec](https://github.com/jwlaboratory/SpecSpec/)

# What and why are we specializing?

Speculative decoding is an inference technique in which a draft model is used to propose multiple tokens for the target model to verify all at once, instead of the target model having to generate one token at a time sequentially. For more information about how speculative decoding works, [read this blog](https://jwlabs.vercel.app/post/speculative-decoding-first-principles).

You can think of the speculator (the drafter) as an approximation for the verifier (the target). An important detail is that the drafter is not trying to be correct in an external sense, but rather trying to copy the verifier.

![The drafter's job is to generate tokens that copy the target, not be correct](/content/specialization-is-all-speculation-needs/image1.png)

We hypothesized that since the drafter is a small approximation of the larger verifier, it has to pick and choose what areas to have the best results. While common regions get modeled well, long-tail regions have gaps. If this is true, specializing the drafter should help us where the base drafter is weakest (out of distribution).

![The target has a much wider tail distribution than what the drafter can approximate](/content/specialization-is-all-speculation-needs/image2.png)

People have tried specialization for speculators in the past, but minimal or no work has been done on dynamic speculators, specializing diffusion speculators like DFlash for domain adaptation, benchmarking at larger batch sizes, using unmerged LoRA/NaRA to serve many specializations at once, and comparing with combined/full fine-tunes. Below we experiment with different domains, different routing, and different trained adapters to see if they improve speculators.

# Speculators are uneven across languages

We first benchmarked the most popular speculator (z-lab/Qwen3-8b-DFlash-b16, a 1B block-diffusion drafter) for Qwen/Qwen3-8B across many languages.

We split WildChat 4.8M by language column and kept 26 languages with at least 1,200 usable prompts/conversations (1,000 train / 100 validation / 100 test split after deduplication). Then, we ran the target model and compared the acceptance rate on the 26 languages, producing the results below.

| language | base DFlash acceptance |
| :---- | :---- |
| Polish | 3.57% |
| Hungarian | 3.92% |
| Korean | 4.19% |
| Dutch | 4.55% |
| Romanian | 4.60% |
| Turkish | 4.89% |
| English | 12.90% |
| Latin | 11.85% |

We found that the speculator is extremely domain sensitive, supporting our hypothesis, having almost 4X variation in accuracy between the highest and lowest accurate languages.

![Base DFlash acceptance across 26 WildChat languages](/content/specialization-is-all-speculation-needs/image3.png)

It makes sense that languages such as English and Latin, with the highest concentration of training data, would perform the best, while languages like Polish and Hungarian, with likely less training data, would perform worse.

# Training Language-Specific LoRAs

LoRA is a process of fine-tuning language models by freezing the original model weights and only training a small slice of the parameters (an additive adapter). This prevents the original model from forgetting information and requires much less data.

We adapt this LoRA for block diffusion models by adding an adapter for all of the attention layers.

Using WildChat-4.8M, we split first-turn prompts by the dataset's language column, used up to 1,000 train / 100 val / 100 test prompts per language, and generated target answers greedily with Qwen/Qwen3-8B.

For each train sequence, we capture the hidden states and the output of the target model. Using this data, we sample random positions (up to 48 times per sequence) in the sequence, and use this to train a rank-16 LoRA for the drafter.

![Swedish rank-16 LoRA validation loss and accept rate converging](/content/specialization-is-all-speculation-needs/image4.png)


The results clearly show that specializing helps the model.

![Own-language LoRA acceptance gains over base, concentrated on the weakest languages](/content/specialization-is-all-speculation-needs/image5.png)

| language | base | own LoRA | gain | relative |
| :---- | ----: | ----: | ----: | ----: |
| Swedish | 6.73% | 8.82% | +2.09pp | +31% |
| Turkish | 4.89% | 6.88% | +1.99pp | +41% |
| Hungarian | 3.92% | 5.72% | +1.80pp | +46% |
| Ukrainian | 5.65% | 7.23% | +1.58pp | +28% |
| Indonesian | 5.18% | 6.68% | +1.50pp | +29% |
| Dutch | 4.55% | 6.03% | +1.48pp | +33% |
| Vietnamese | 7.31% | 8.75% | +1.44pp | +20% |
| Malay | 6.19% | 7.60% | +1.41pp | +23% |
| Romanian | 4.59% | 5.88% | +1.29pp | +28% |
| Korean | 4.19% | 5.31% | +1.12pp | +27% |
| Polish | 3.57% | 4.66% | +1.09pp | +31% |
| Persian | 6.50% | 7.52% | +1.02pp | +16% |
| Portuguese | 6.59% | 7.46% | +0.87pp | +13% |
| Tagalog | 6.44% | 7.16% | +0.72pp | +11% |
| Arabic | 5.73% | 6.43% | +0.70pp | +12% |
| Russian | 8.20% | 8.61% | +0.41pp | +5% |
| Chinese | 7.54% | 7.85% | +0.31pp | +4% |
| German | 8.79% | 9.07% | +0.28pp | +3% |
| French | 10.98% | 11.24% | +0.26pp | +2% |
| Spanish | 11.47% | 11.68% | +0.21pp | +2% |
| Esperanto | 6.58% | 6.78% | +0.20pp | +3% |
| Italian | 7.84% | 8.00% | +0.16pp | +2% |
| Latin | 11.82% | 11.90% | +0.08pp | +1% |
| Japanese | 7.94% | 8.02% | +0.08pp | +1% |
| Yoruba | 8.57% | 8.61% | +0.04pp | +0% |
| English | 12.89% | 12.80% | −0.09pp | −1% |

We observed that the weaker languages got the largest gains. For example, Hungarian jumped **+46%** relative to its base. On the other hand, stronger languages like English actually got slowed down, probably because the base was already so strong. This supports the hypothesis that these models have the largest headroom in out-of-distribution regimes.

# LoRA beats a full fine-tune

We next wanted to make sure that a full fine-tune does not vastly outperform the LoRA. So we used the same training data to train a full fine-tune of the model. Each domain's full fine-tune performed *worse* than the LoRA.

![Own-language LoRA gain vs full DFlash fine-tune on the weakest language lanes](/content/specialization-is-all-speculation-needs/image6.png)

| language | base | own LoRA | own gain | full FT | full gain |
| :---- | :---- | :---- | :---- | :---- | :---- |
| Polish | 3.57% | 4.66% | \+1.09pp (+30.5%) | 3.66% | \+0.09pp (+2.5%) |
| Hungarian | 3.92% | 5.72% | \+1.80pp (+45.9%) | 4.04% | \+0.12pp (+3.1%) |
| Korean | 4.19% | 5.31% | \+1.12pp (+26.7%) | 4.30% | \+0.11pp (+2.6%) |
| Dutch | 4.55% | 6.03% | \+1.48pp (+32.5%) | 4.68% | \+0.13pp (+2.9%) |

We believe this does not show that full fine-tuning is bad or impossible, but rather that tuning all the parameters at once would require a lot more data to avoid being starved, while a limited rank-16 adapter (a small percentage of total parameters) can converge much faster.

# Training a router between LoRAs
Additionally, we train a tiny router that uses the target-hidden features that DFlash uses anyway. The router is a 2-layer MLP that takes the hidden features (20480) to route between the 26 languages with 10.5M parameters, and since it is so small, its compute/time cost is basically negligible.

![26-way language router training curve — train loss and validation accuracy](/content/specialization-is-all-speculation-needs/image7.png)

It scores very high, with 84.69% validation accuracy and 81.58% test accuracy:
![26-way WildChat language router per-class accuracy](/content/specialization-is-all-speculation-needs/image8.png)

(English here contains other stuff as well, like SQL, Latin, etc, which may be dragging down the score)

We wanted to make sure the router would not cause an increase in latency, but because it is so tiny compared to the actual model, the cost fully amortizes to almost nothing.

![Router costs almost nothing (log scale) compared to the Qwen3-8B prefill](/content/specialization-is-all-speculation-needs/image9.png)



# Combined LoRA keeps a lot of the gains

Next, we wanted to see if the LoRA specialization was due to each adapter uniquely learning the domain, or just because it was exposed to more specific knowledge. The hint that told us to investigate this was that the hidden states cleanly separated the different languages well when routing between languages.

We also wondered if combining many languages could improve performance. Some languages come from the same family and carry semantic meaning that is complementary.


We tried an experiment of training a single "combined LoRA" over all the languages and compared its performance with the own-language LoRA.

![Combined LoRA gains almost as much as specialized LoRA compared to base](/content/specialization-is-all-speculation-needs/image10.png)

Averaged over the 26 clean languages, the per-language specialists gain +0.85pp over base and the single combined adapter gains +0.70pp, a delta of just +0.15pp. The specialists win on most languages (19/26 languages), but the combined adapter is never far behind, and it actually wins on 6. We guess that the languages the combined model wins at (Esperanto, Yoruba, Tagalog, Malay, Indonesian, and Latin) are low-resource languages where cross-lingual transfer from related languages helps it generalize more than the specialized knowledge.

![Combined retains most of the gains from the specialization on speedups](/content/specialization-is-all-speculation-needs/image11.png)


This implies that for cleanly separable domains, a single combined LoRA is sufficient. Training individual specialists is only necessary when the model cannot cleanly separate the task in its hidden state. Because language is an easily separable task, it is largely first a matter of adding more training data for out-of-distribution languages to improve the quality. When this saturates, then, perhaps our specialization will further shine.

# Interference gets real in more fine-grained domains

In domains in which the model has a hard time cleanly separating tasks, we experience the "muddling" of combined experts (more training data does not solve this; the small number of parameters means it muddles between 2 experts, and therefore needs specialization).

We tried cursory experiments (but leave the full experiments up for a follow-up blog).

First, we build an interference ladder that shows 10 combined domains vs 20 and 40 combined domains.

| combined adapter | mean gap vs own specialist | 95% CI | gain retained |
| :---- | ----: | :----: | ----: |
| 10 domains | −0.21pp | [−0.29, −0.13] | ~74% |
| 20 domains | −0.27pp | [−0.34, −0.20] | ~70% |
| 40 domains | −0.28pp | [−0.36, −0.19] | ~67% |

As you can see, as you increase the number of experts, the interference increases and specialists shine further.


Second, to prove that languages are easy and low interference, we try other English subdomains (code_python, code_sql, ood_legal, ood_medical, ood_financial, task_math_reasoning, task_summarization).

![The specialists beat the combined router heavily in hard to separate tasks](/content/specialization-is-all-speculation-needs/image12.png)

The per-domain specialists beat the base 7/7 as expected, but the key point is that the combined adapter only retains about 20% of the specialist gain. This is completely different from the language setting, where the combined LoRA retains most of the specialist gain.

# Serving Cost


We first compared all the different ways to serve the specialized drafter. Merging is a process in which you take the low-rank adapter LoRA weights and you mathematically multiply them with the existing weights to create a merged single set of weights as if it was just a new fine-tuned model. The benefit of keeping them unmerged is that you can keep most of the weights the same so you have a lower memory footprint because you just need to swap out your final adapter weights. As soon as you merge, then you need to keep multiple copies that are very similar but to the computer look entirely different.

We compared one merged model with the combined LoRAs, compared with multiple N individually merged specialized LoRAs, compared with N unmerged hot‑swappable LoRAs.

Because vLLM does not support hot swapping unmerged LoRAs, we tested this on HF.

| mode | meaning |
| :---- | :---- |
| base | DFlash, no LoRA |
| merged\_combined | one combined language LoRA folded into DFlash weights |
| merged\_own | routed traffic to N already-merged language specialists |
| hotswap\_own | one drafter with unmerged per-language LoRA hot swapping |

![Comparing base, merged_combined, merged_own, and hotswap_own at batch size 1](/content/specialization-is-all-speculation-needs/image13.png)

| mode | tok/s | vs target-only | vs base DFlash | acceptance | mean accept length |
| :---- | ----: | ----: | ----: | ----: | ----: |
| target-only | 46.78 | 1.000× | — | — | — |
| base DFlash | 66.33 | 1.418× | 1.000× | 6.46% | 1.969 |
| merged combined LoRA | 70.23 | 1.501× | 1.059× | 7.17% | 2.076 |
| N merged own LoRAs | 70.55 | 1.508× | 1.064× | 7.33% | 2.099 |
| hot-swapped own LoRAs | 54.73 | 1.170× | 0.825× | 7.32% | 2.098 |

This shows us that hotswapping LoRAs without optimizing this (punica styled batch kernels perhaps) is unworkable. On the other hand, merged-combined and N merged-own show promising results. Combined LoRA gives a \+5.9% wall-clock gain over base DFlash on this mixed-language serving stream, and the one-time merge setup was only 0.073s. The N-merged-specialist path gives \+6.4% over base DFlash, only about \+0.5% relative to the merged combined LoRA.

We tried on vLLM at different batch sizes on one of the best performing LoRAs (Swedish), which performed remarkable. Note that the batch size 1 result is different from above because we use vLLM and not HF.

All numbers below are net wall-clock speedup vs no speculative decoding (target-only).

| batch size | merged own | merged combined | base DFlash | merged own vs base |
| ----: | ----: | ----: | ----: | ----: |
| 1 | 1.73× | 1.69× | 1.50× | +15.3% |
| 4 | 1.78× | 1.73× | 1.56× | +14.1% |
| 8 | 1.63× | 1.59× | 1.42× | +14.8% |
| 16 | 1.29× | 1.28× | 1.13× | +14.2% |
| 32 | 0.82× | 0.81× | 0.73× | +12.3% |
| 64 | 0.51× | 0.48× | 0.45× | +13.3% |

![Swedish serving speedup vs batch size](/content/specialization-is-all-speculation-needs/image14.png)

At a higher batch size, even naive speculative decoding doesn't help anymore because we're no longer memory bound, but rather compute bound. But the cool thing to observe is that at these lower batch sizes, the Swedish specialist gives up to a 15.3% gain over the base DFlash, and the combined LoRA nearly matches it, plus 12% at batch size 1.

The benefit of merged-combined is that you only need 1 set of weights. It's essentially just the drafter with more knowledge. However, it's not specialized and may have interference (as we've somewhat shown).

The benefit of N-merged LoRAs is that you do not have any intereference and can have extreme specialization. The negative is that you now need to store more weights and this may perform poorly when constantly needing to swap in and out weights with heavy batch sizes. With larger batches (say size B), we will need to pull in potentially N different experts, instead of previously only needing to pull in 1 expert. Similar to the MOE speculation problem, this is bad because in an already memory bound system we are further hurting the memory pipe.

We then benchmarked using vLLM to see at different batch sizes with a "MIXED BAG" of different requests from different languages. This forced the model to use the combined merged LoRA and the speedups are shown below:

| batch size | merged combined | base DFlash | merged combined vs base |
| ----: | ----: | ----: | ----: |
| 1 | 1.495× | 1.418× | +5.4% |
| 4 | 1.476× | 1.393× | +6.0% |
| 8 | 1.363× | 1.270× | +7.3% |
| 16 | 0.976× | 0.914× | +6.8% |
| 32 | 0.662× | 0.622× | +6.4% |
| 64 | 0.377× | 0.355× | +6.2% |

![Mixed 16-language serving stream: merged combined vs base DFlash speedup across batch sizes](/content/specialization-is-all-speculation-needs/image15.png)

Even on a fully mixed stream, one combined adapter holds a +5–7% wall-clock edge over base DFlash across batch sizes (peaking at +7.3% around batch 8), with a single drafter and no routing. As before, the overall speedup still falls with batch, crossing break-even around batch 14.

We leave a future experiment to try to update the vLLM implementation and kernels to test how much slowdown hotswapping adapters or swapping entire drafters would cause within batches.

# Conclusion

For languages, specialization is almost all speculation needs. The core result is that a small LoRA can recover much of the drafter's long-tail weakness, and because language domains interfere surprisingly little, one merged combined LoRA captures nearly all of the specialist gain without the serving cost of hot-swapping adapters.

![Speedup of the specialized Swedish DFlash (+15.3%) and the merged combined adapter on a random mixed stream (+5.4%) over base DFlash](/content/specialization-is-all-speculation-needs/image16.png)

Speculation does indeed work, as we see recent work from [Modal](https://modal.com/blog/introducing-auto-endpoints) and [Baseten](https://www.baseten.co/blog/live-draft-model-training-for-speculative-decoding/) showing that production systems are moving toward per-customer or per-workload speculators. Our version is complementary because it trains lightweight LoRAs for each workload, then merges or routes them when useful, allowing you to serve many tenants from the same GPU pool without keeping a separate drafter for everyone.

We also think it is promising to try specializing in more niche domains, such as math and SQL, where it is important to align the drafter to the target model. We hope to post a follow-up blog that explores these niche domains more.


# Future Ideas
1. In this research, we try language domains and briefly experiment with more specialized fine‑grained domains within English, which show more interference and higher gains from specializing. We should further try this with more domains that are within more niche groups and see how they perform.

2. We should try other drafters, for example Eagle3, DSpark, and completely independent drafters, and test across larger models as well, not just 8B models, to see how they perform.

3. We should also try a quick sweep over low-rank adaptation ranks in other domains. From a brief examination of rank comparisons within languages, we found very little change between rank 16, rank 4, and rank 64 in terms of performance, which may also affect speedups because it reduces the amount of weights that need to be loaded into and from memory.
*/ }),
  },
  {
    slug: "llm-rl-assembly-codegen",
    title: "Using Large Language Models and Reinforcement Learning to Beat -O3 Assembly Code Generation",
    date: "2026-04-24",
    category: "Research",
    hidden: true,
    summary: "Various attempts at trying to optimize assembly code generation, through graph neural networks, compiler flag search, and LLM superoptimization.",
    markdown: markdown(() => { /*

    # Using Large Language Models and Reinforcement Learning to Beat \-O3 Assembly Code Gen

By: Shrey Birmiwal, Avi Agrawal, Damodar Kamani, Krish Patel-Shah, Roger Wang, Sambit Kanjilal, Mohammad Al Masalmeh, Praneel Bhagavatula, Rayan Nyaupane, Shashank Chathapuram, Vedanth Chamala, and Shriyaa Balaji.
Advised by: Dhilan Shah

# Preface

We are college freshmen with little or no experience in the fields discussed in this blog, such as RL, assembly, or compilers. This blog isn’t intended to be a showcase of knowledge or a paper describing results, but rather, a compilation of our learnings and experiments in our quest to learn about this interesting field. We look forward to feedback and discussion — our goal with this blog and organization is to create a space to tackle hard technical problems with the aim of learning and thinking.

# Abstract

We share a few projects in our quest to learn and advance the frontier of compiler code generation:

1. A failed attempt at multi-turn RL’d LLM to debug assembly, building on top of SuperCoder: LLM superoptimizer
2. TBD A specially trained version of SuperCoder to maintain performance even for long-context programs, using lazy-edits and fast-apply
3. TBD Our exploration of using graph neural networks, building on top of PROGRAML for LLMs to better understand and generate assembly
4. TBD A genetics-based algorithm combined with RL to determine optimal compiler flag orderings, built on top of AutoPhase and Genetic algoxyz
5. TBD Our open-source pip-install benchmarking tool standardizes and combines researched assembly code benchmarking (both static and dynamic) into an easy-to-use package

# The Problem: Why mess with compilers?

Compilers like GCC are the backbone of all modern software. Compilers take high-level languages, such as C, and convert them into low-level, machine-specific assembly. Compilers are given the freedom to optimize and rewrite the program in the process in the pursuit of further optimization, with the constraint of strictly maintaining the execution behavior of the original program.

The compiler exposes various flags that can set the amount of ‘aggressiveness’ it uses to optimize your code. When you compile with the \-O3 flag, the compiler aggressively unrolls loops, vectorizes data, and inlines functions. However, compilers fundamentally rely on rigid heuristics and generalized rule-based transformations. Additionally, they guarantee the generation of an assembly program that is verifiably 1:1 with the original program, leading to a rigid, sometimes unreasonable assembly program.

In the example below, it is easy to see that the for loop is doing a simple memcopy. The compiler lacks the "big picture" intuition to recognize that the entire assembly can be written with just one operation. The compiler acts strictly as a state machine, trying to make *this specific loop* faster.

Original code:
\`\`\`c
for (int i \= 0; i \< total\_bytes; i++) {
d\[i\] \= s\[i\];
}
\`\`\`
Alternative, better:
\`\`\`c
memcpy(dest, src, num\_elements \* sizeof(int));
\`\`\`

Another example, albeit slightly more abstract: Imagine the computer needs to sum 100 floating-point numbers to calculate a shadow in a video game.

We would expect an optimized computer to sum together parallel accumulators. But, since floating point addition *isn’t* commutative (rounding errors, precision errors), and since the compiler has to maintain 100% accuracy, the computer has to add them up one by one, being extremely slow. Imagine an LLM that could understand “okay, the shadow being off a micromillimeter for a 10x speedup is a good tradeoff.”

We envision LLMs being used to understand the “*programmer's intent,”* enabling the compiler to negotiate tradeoffs, make smarter decisions, and see the bigger vision, creating maximally optimized code. A quote from Elon Musk’s xAI all-hands: “In the next year, we see AI generating optimized binaries directly \- no need for compilers.”

# 1- Multistage assembly generation with RL’d LLMs

### Prior Art

We were interested in seeing how large language models could create binaries of programs directly (forgoing the compiler altogether), which led us to discover “SuperCoder: Assembly Program Superoptimization with Large Language Models” by Wei 25 et al.

The SuperCoder paper describes providing an LLM with C code and gcc \-o3-generated code, and asking the LLM to generate more optimized assembly code. They use a dataset derived from competitive programming, so that a valid set of inputs and outputs is saved and can be used to “loosely” verify the correctness of the generated code.

SuperCoder reports base models perform poorly \- Qwen2.5-Coder-7B compiles only 77.9% and passes all tests 61.4% of the time, resulting in an average speedup of 1.1x. However, after training the model using RL on 7,872 programs (rewarding for speedup, and 0 reward for no compilation), they boast SuperCoder (PPO) at 96% compile pass, 95% test pass, and an average of 1.46x speedup.

This is pretty amazing \-- but realizing that compilers have to always ensure correctness, we wondered how we can improve the reliability of these models. We replicate the SuperCoder paper setup as closely as possible (same HF dataset split, same prompt source, same x86-64 Linux toolchain and benchmark path), with generation on Modal. We then inspected *why* the remaining runs fail, to see whether failures look like irreducible model limits or like repairable mistakes.

| Common mistake | Example | Explanation |
| :---- | :---- | :---- |
| Instruction syntax | Number of operands mismatch for mov, unbalanced parentheses | Hallucination from model forgetting syntax of ARM assembly |
| Structural Integrity | Missing .cfi\_endproc, .cfi\_def\_cq | Token truncation or failure to generate boilerplate closing directives |
| Incorrect references | Local label "1" is not defined, undefined reference to f | References to labels/functions that were deleted or renamed during optimization |

Reading through these errors, we wondered: why is it that the LLM is making such silly, simple mistakes? When you ask something like "Claude Code, go through the same task," we noticed that Claude Code would break the problem into steps:

1. Hypothesizing how to improve it
2. Actually applying the assembly code changes
3. Running, debugging, and further optimizing it in an agentic loop

We wondered, can we bring this agentic behavior into Super Coder?

### Experiment 1: ‘A Thinking Stage’

The goal is a multi-stage agentic loop by first adding a stage that proposes what to improve in compiler-produced assembly (given C \+ `- O3`\-style asm), then, a downstream model (e.g. SuperCoder-style editor) improves assembly using that thinking as extra context. The intuition is that this increases total thinking time and can improve the quality of the assembly.

#### Subexperiment A

We use Qwen2.5-Coder-7B-Instruct with a generic instruction: list optimizations that might speed up the assembly.

Prompt:
\`\`\`
You are given C source code and compiler-generated x86-64 assembly.

Task: List optimizations that might improve the execution speed of this assembly. Give a numbered list.
\`\`\`

Example Results (nearly identical for all input)
\`\`\`
1\. Use SIMD instructions
2\. Optimize loop unrolling
3\. Use cache-friendly data structures
4\. Profile and optimize for hot loops
\`\`\`

This is useless because the model fills the rubric with generic performance vocabulary instead of grounded assembly reads. The second stage model treats this input as 100% knowledge, so it tries to optimize with a pigeonhole of looking at garbage.

#### Subexperiment B

We use the same model, but force the prompt to force the model to be more specific.

Prompt:
\`\`\`
You are given C source code and its compiler-generated x86-64 assembly.
Analyze the SPECIFIC assembly below and list concrete, actionable optimizations.

Rules:
\- Reference specific labels or instructions by name (e.g. "the imulq at .L7 can be replaced with...")
\- Explain WHY each thing is suboptimal in THIS code
\- Do NOT suggest generic advice like "use SIMD", "profile first", or "enable \-O3"
\- Do NOT write any assembly or C code — observations only
\- Keep each item to 1-2 sentences max
\`\`\`

Example results
\`\`\`
1\. The \`imulq\` at \`.L7\` can be replaced with \`mulq\` followed by \`addq\` and \`subq\` to
   avoid the sign extension and division operations...
2\. The \`sarq\` operations in \`.L7\` can be replaced with \`shrq\` to improve performance,
   as \`shrq\` is faster on modern CPUs.
3\. The \`leal\` instruction in \`.L7\` can be replaced with \`addq\` to simplify the code...
4\. The \`xorl\` instructions in \`.L7\` can be removed if they are not necessary...
5\. The \`cltd\` instruction in \`.L7\` can be removed if it is not necessary...
6\. The \`sarq\` operations in \`.L7\` can be replaced with \`shrq\`...
7\. The \`leal\` instruction in \`.L7\` can be replaced with \`addq\`...
   ... (points 6–67 are the same 4 suggestions repeated verbatim in a generation loop)
\`\`\`

First, its important to note that almost every suggestion in this is incorrect and would lead to the program breaking.

Analysis:
This is useless because the model invents micro-edits to satisfy the “name an instruction” constraint, and the second stage anchors on that text as if it were ground truth. Additionally, this model is creating pure garbage improvements that are not actually improvements, and are hallucinating things to change that would break the original code

#### Subexperiment C

We add to the prompt that it is allowed to say no improvement. We do this because experiment B showed hallucinations of adding random improvement suggestions (presumably because it was forced to generate some improvement suggestions)

Prompt:
\`\`\`
    "You are an expert x86-64 assembly programmer and performance engineer. "
    "When given assembly code, you analyze it instruction-by-instruction and identify "
    "specific inefficiencies by referencing exact labels and instructions. "
    "You never give generic advice. You never write code. "
    "You output only a numbered list of specific observations about the given assembly. "
    "If you cannot find a real, concrete inefficiency, output NOTHING. "
    "Do not fabricate or stretch observations just to have something to say."
\`\`\`

Results:
The model just says "NOTHING" for all 1700 training data examples\! The model isn't confident and isn't willing to try anything\!

Analysis:
This is the "Safe Exit" trap. It chose "do no harm" over attempting the complex logic. The fix to experiment B (stop hallucinating) successfully killed the hallucinations — but only by killing all output, so there is no signal left for a downstream SuperCoder editor to condition on. Since the second model once again relies on the thinking model to think of improvements, the entire optimization chain is killed.

#### Experiment takeaways

This clearly did not work. Neither did tuning the prompts; they all caused us to dig into a new hole that didn’t help. We hypothesize a few reasons

1. Models (especially tiny ones) aren’t trained to identify assembly, but are much better at fixing and writing it because of the type of training data
2. Specific prompts implicitly force the second model to listen to whatever the first model generates, causing more pigeonhole

We wonder if a better approach exists for this \-- can we train an ‘identify’ model using RL or SFT? This is a hard problem because we don’t have an easy way to score outputs and we don’t have a dataset of ‘correct’ or ‘most optimal’ assembly. Perhaps for SFT, we can use a stronger model like Opus to suggest the correct answer? Open question for the future\!

### Experiment 2: ‘A Debug Stage’

As we hypothesized in the first experiment, models are better at fixing or creating new assembly than at predicting what to improve, since they are likely trained on data like Stack Overflow, so here we hypothesize: what if we scrap the first predict stage, but add a 3rd stage that fixes broken assembly?

We’ll use reinforcement learning in similar fashion to the original paper, but instead trained to debug assembly, as the original paper saw success in teaching code gen through RL.

#### Data

We run qwen-2.5-coder-7b-instruct with the same SuperCoder prompt on the entire train and validation dataset from the SuperCoder paper. We then record all the failures (failure to compile, failure to pass all test cases) in a new dataset.

The reason we chose to use the SuperCoder harness but to use Qwen-2.5-coder-7b-instruct instead of SuperCoder is to create a dataset that looks plausible for SuperCoder to make mistakes on, but to get a large enough dataset that we can actually train on (SuperCoder only had \~4% mistake rate, so that would leave us with very little data).

| debug\_train | 4,139 |
| :---- | :---- |
| debug\_val | 74 |

Each row has c\_code, unoptimized\_assembly, the broken qwen\_assembly, test\_cases, and the captured error (compile stderr or wrong-output diff), plus a ready debug\_prompt.

Here’s an example prompt:

\`\`\`
You are an expert x86-64 assembly programmer. Fix the following incorrectly optimized assembly code for x86-64 Linux (compiled with gcc, linked with \-lm). The assembly must compile with \`gcc \<file\>.s \-o \<file\> \-lm\` and produce correct output for all test cases. Output ONLY the corrected x86-64 assembly code — no explanations, no markdown fences, no additional text.

The error is:
\[error message\]

The correct C code is:
\[c code\]

The incorrectly optimized assembly is:
\[assembly\]

Generated, correct but still optimized assembly:
\`\`\`

#### Subexperiment A

We try following the exact same training method as the SuperCoder paper, but with the new data. Same base model, same reward function: 0 if compile fails, 0 if any test fails, else avg\_speedup vs the unoptimized reference.

Results:
It did not learn anything at all. Validation loss did not meaningfully decrease, and the critic/rewards/mean stood effectively flat/noisy the entire duration of training.
![][image1]

We believe that this is likely because this reward function stacks 3 big hurdles into 1:

1. Fix the original compile error (likely harder than generation)
2. Pass all tests
3. Beat GCC timing


The result of this is extremely sparse rewards and extremely random rewards. The model doesn’t really know what's good and bad. From a cold Qwen init it rarely clears even hurdle 1\. The occasional \`max=1.1\` sample shows it can luck into a fast correct fix, but because the other 15 samples in the batch return exactly \`0\`, the reward is near 0 and drifts the policy into the abyss.

We wonder, what would happen if we pre-trained using SFT to teach the rules of assembly and potentially help this model get denser rewards?

#### Subexperiment B

From our first experiment A, we saw that rewards were sparse, probably because the task was too big to solve at once (debugging and speeding up). What if we tried to just reward for debugging, and give partial rewards for improving the debugging state?

The new reward function can be described as the \# test cases passed / len(inputs)

A model that fixes 3/5 test cases now gets 0.6 instead of 0\. We deliberately drop the speedup term — the hypothesis is that learning "produce compilable, correct assembly from a broken one \+ error" and learning "make it faster than \-O3" are two separate skills, and stacking them on one reward is why exp3 stalled. Speedup comes back later as a downstream SuperCoder step.

![][image2]

Wow, we see the model actually learning to debug\!

![][image3]
We definitely see the rewards increase over time, meaning that this is a successful training run.

#### Results of subexperiments A and B

Let’s see how these actually perform on the validation dataset\!
First, we see on the debug-val dataset a definite, 17% increase in compile rate for programs over just using Qwen or SuperCoder\!
![][image4]
![][image5]
We see a massive, nearly **7x** increase in the rate at which the programs pass all test cases\!

This is clear evidence that we trained a model that is repeatedly successful at debugging broken assembly code\!

But does this actually lead to a better 2-stage model?

#### Analysis of subexperiments A and B

Debug val is Qwen-generated failures. The real question is: does chaining SuperCoder and Debug2 on SuperCoder's own failures recover extra correctness?

After running SuperCoder on the 200 validation dataset, we find 9 errors. Of those errors, debug2 fails to solve ANY of those 9 errors. :(

Why did this not work? We have a few theories:

1.  SuperCoder only made 9 mistakes. It’s hard to properly test if we can improve on just a small dataset of 9 mistakes
2. The training data might not necessarily represent the real world of SuperCoder. SuperCoder likely makes different mistakes as it learns throughout its training

Another trade-off to mention is the increased computation required to disaggregate into a 2-step agent.

### Experiment 3: ‘Curriculum Learning”

This leaves us with an interesting idea: What if we layer ‘learning’ of debug models and SuperCoder models on top of each other? How do they now perform as a 2-shot and as a 1-shot model?

We hypothesize that by teaching a model to debug first, then to optimize, it can learn more and generalize knowledge to have fewer errors and more accuracy.

Using the debug-rl2 model (experiment2, subexperiment B: [Paper](https://docs.google.com/document/d/1qtSCoqjvcFcndEpfFr86BtVgJ65fAG7G46s2F7lFyJc/edit?tab=t.0)), we use that model checkpoint to train SuperCoder *directly on top* of the weights.
![][image6]
![][image7]
The results are disappointing. While the mean reward on validation is increasing, it’s not necessarily increasing during the training.

Additionally, when compared to the original SuperCoder validation reward, SuperCoder reaches peaks of 1.22, blowing the rewards of our debug-SuperCoder model.

We ran inference benchmarks to compare the models definitively on the validation set of SuperCoder.
![][image8]

Unfortunately, the results prove that our new model is net-worse. We hypothesize that this is because, by training debug first, we teach the model to make tiny, safe edits (without worrying about optimization). Then, when it is trained to optimize (SuperCoder stage), it has to try to forget the prior knowledge. In this case, the base qwen model had no ‘bad prior learning’ and was able to learn faster\!

Note below is the chart of validation reward of the SuperCoder original model (using qwen as base) in blue vs orange. Reward starts extremely low \~(.3 vs. 8), but it is clear that SuperCoder learns extremely quickly, whilst debug-supercoder is very slow (if anything) to learn. The knowledge base of the base model can put the training in a ‘hole’ by going too deep in a vertical it shouldn’t know about.

![][image9]

The original curriculum learning paper that we were adjacently inspired by explains that curriculum learning is best fit for tasks with a clear progression, for example simple math to more complex math. For 2 tasks that aren’t exactly aligned (with different goals), it’ll either require a lot more data to generalize the curriculum or not learn well.

# 2 \- Solving long context with lazy-edits

### Prior Art

Superoptimization is the task of transforming a program into a faster one while preserving its input-output behavior, first coined by Henry Massalin in the 1987 `Superoptimizer – A Look at the Smallest Program` paper. As the title suggests, search algorithms for superoptimization fail to scale beyond small, loop-free programs.

An excerpt from the paper:
“Even with the probabilistic test, the exhaustive search still grows exponentially with the number of instructions in the generated program. The current version of superoptimizer has generated programs 12 instructions long in several hours running time on a 16MHz 68020 computer. Therefore, the superoptimizer has limited usefulness as a code generator for a compiler.”

The SuperCoder paper, using an LLM, was able to break the wall of only a few line programs by using a non-deterministic heuristic. Still, we notice the paper uses only an average of \~22 lines of C code and \~130 lines of assembly code

![][image10]

Since real systems programs are much longer and complex, to make SuperCoder work in the real world, we need a way to expand the training to longer programs.

Using the CodeNet dataset, we construct a new, bucketed dataset with the following statistics:

|  | Count | Mean | Min |
| :---- | :---- | :---- | :---- |
| **short** | 56283 | 10.7 | 1 |
| **medium\_short** | 56283 | 18.4 | 16 |
| **medium\_long** | 56283 | 25.6  | 22 |
| **long** | 56283 | 66.0 | 31 |

Then, we run benchmarks on each bucket:

![][image11]

It is clear to see as the context gets longer, the models perform worse.

We hypothesize that using lazy edits, ie, prompting the LLM to generate diffs instead of regenerating full files, increases accuracy on long files and decreases hallucinations. Another benefit of this may be that even on small programs, increases in direct, targeted performance improvements and decreases in bugs such as syntax or forgetting prior directives.

### Introduction to lazy-edits and fast-apply

Lazy edit and fast-apply
\[to be written up\]

### Experiment

First, we need to see, can the tiny 7b Qwen model understand the instructions to lazy edit? Can this even be something we can train on without any SFT at all (will we have a sparse reward issue, if doing raw RL?)

We update the prompt to include the instructions from [morphllm.com](http://morphllm.com) to lazy edit:

\`\`\`
   "Given the following C code and assembly code, your task is to generate highly optimized x86-64 assembly code.

C Code:
   "\`\`\`c\\n{c\_code}\\n\`\`\`\\n\\n"

Assembly Code:
   "\`\`\`assembly\\n{unopt\_asm}\\n\`\`\`\\n\\n"

Only output the (lazy edit) optimized assembly code. Do not include any other text. Wrap the assembly code in \`\`\`assembly\`\`\` tags.

How to lazy edit:
Use \\"// ... existing code ...\\" to represent unchanged code blocks. Include just enough surrounding context to locate each edit precisely. Example format:

   "// ... existing code ...\\n"
   "FIRST\_EDIT\\n"
   "// ... existing code ...\\n"
   "SECOND\_EDIT\\n"
   "// ... existing code ...\\n"

Rules:
"- ALWAYS use \\"// ... existing code ...\\" for unchanged sections (omitting this marker will cause deletions)
\- Include minimal context around edits only when needed for disambiguation
\- Preserve exact indentation
\- For deletions: show context before and after, omit the deleted lines
\- Batch multiple edits to the same file in one call

 Optimized Assembly Code:

\`\`\`

Then, we run the same benchmarks from the prior art on both SuperCoder and on the base Qwen model and observe:

The SuperCoder completely ignored instructions\! But that’s okay \- it probably did that because it was already RL’d to a specific knowledge of understanding and went with what it knew.

On the other hand, the base Qwen model did seem to generate something following the rules\!
\`\`\`assembly
// ... existing code ...
movl	$0, \-16(%rbp)
movl	$0, \-12(%rbp)
// ... existing code ...
movl	\-24(%rbp), %edx
movl	\-28(%rbp), %eax
cmpl	%eax, %edx
jge	.L3
movl	\-16(%rbp), %eax
addl	$1, %eax
movl	%eax, \-16(%rbp)
jmp	.L4
.L3:
movl	\-12(%rbp), %eax
addl	$1, %eax
movl	%eax, \-12(%rbp)
.L4:
addl	$1, \-20(%rbp)
// ... existing code ...
movl	\-12(%rbp), %edx
movl	\-16(%rbp), %eax
cmpl	%eax, %edx
cmovle	%edx, %eax
// ... existing code ...
\`\`\`

This is good news \-- it shows that Qwen can follow the instructions, and thus we can proceed with building out our RL pipeline and it should work (no super sparse rewards from failing too or skipping the lazy edits requirement)

### Subexperiment A

The goal of this subexperiment is to simply test the thesis: Lazy edits can improve accuracy and performance of the main model. For simplicity, we won’t create a new reward function or a bigger dataset with longer programs for now. We will copy SuperCoder’s methodology but only change the prompt to include lazy-edit instructions.

![][image12]
Validation reward looks great \-- improving on SuperCoder significantly and showing clean improvements each iteration.

Additionally, our metric for tracking Morph Fast Apply usage is positive \-- showing that the model is learning and using the lazy-edits correctly, and not just ignoring those instructions and trying to generate assembly itself. (This might also foreshadow the fact that it learns better with lazy-edits because why else would it keep exploring this path in RL if it was not successful?)
![][image13]

# 3 \- Graph neural networks to understand programs better

### Prior Art

# 4 \- Genetic-based compiler flag optimization

### Prior Art

# 5 \- Our pip-install benchmarking tool

### Prior Art

### Benchmarking

Evaluation is a big problem How would we verify the correctness of the optimized assembly and benchmark the performance?

- Can formally verify or we could use random input test cases
- found formally verification too hard (room for future work) and used random input test cases wasnt comprehensive enough
- Luckily competitive coding sites like codeforces have extensive test cases for us to use, so we used this dataset
- Built our own benchmarking suite and open sourced it: \--\> built timing on linux docker containers \+ uses hyperfine to standarize the cache \--\> checks for correctness, static performance metrics, clock cycles, etc \--\> open sourced it: [https://github.com/jwlabs/infra/tree/main/hyperfine](https://github.com/jwlabs/infra/tree/main/hyperfine) \--\> easy to use and integrate into any project

# Future Work

- formal verification

*/ }),
  },
  {
    slug: "tab-model-schematic-design",
    title: "Training an Autocomplete 'Tab' Model for AI Schematic Design",
    date: "2026-05-05",
    category: "Research",
    hidden: true,
    summary: "Exploring how to build a tab-completion model for schematic design, similar to Cursor's tab model but for PCB/schematic editors like Protoflow.",
    markdown: markdown(() => { /*
# Training an autocomplete ‘tab’ model for AI schematic design

By: Shrey Birmiwal, Rishik Bodetti (Protoflow CEO)

\*\*\* send to team at: https://x.com/benln/status/2050970577255411756?s=20

# Overview

### What is ProtoFlow

Protoflow is an AI native PCB and schematic design application \-- similar to KiCad, but with AI native features. For example, you can describe what you want in plain English, like “connect an ESP32 to a DAC with proper decoupling, and the AI generates the sub‑circuit, including passives and wiring. One way to think of Protoflow is the ‘cursor’ for schematic design.

### Why a tab model for ProtoFlow

Cursor, an AI code editor, however, in addition to agent mode (prompt to generate code) has a unique feature: a tab model that predicts what you will code next, then displays a ‘ghost’ preview of your predicted edits. The user can just ‘tab-tab-tab’ through predictions, and the model is extremely good at the cursor.

We wondered, can we create a model like that for schematic design? Can we create a model that predicts the next connection or placement of parts and run inference at such low latency and high accuracy that it is actually useful to the development flow of users? We think this is doable since it’s a much simpler problem: No need to worry about multiple code files, schematics are much easier represented than code (various languages, etc), and schematics inherently have rules and patterns in them.

# Dataset creation

We first consider how we would gather the necessary data for training this project. Since we are predicting the user’s next action, we would need to train on data that has prev state-\>next state. We can do this by curating a dataset that follows users' lineages (the list of actions that led them to the next state).

Thinking ahead, we could train the model such that, given an initial state, it would be rewarded for getting closer to a final, complete schematic. But we believe that such an approach might have the model start doing generic things, like placing batteries or random connections that are plausible but not actually correct. Instead, we break it into step-by-step rewards/training: the model will train to match the human development lineage.

### Augmenting data by working backward

We consider collecting this data from real users by watching the action sequences they take in our app and snapshotting the state at each step (creating input-output states). However, we feel this would take too long to collect the necessary data, and would not be fully representative of all the types of schematics people can create, may cause privacy issues, and may be better suited for online RL later down the road.

Instead, we opt for augmenting our data using large language models. We can start by scraping lots of kicad\_sch files from GitHub and verifying the validity/completion/correctness of the file by using kicad\_cli and various basic checks (version, over 5 components, etc). Then, we use LLMs to generate plausible and likely states. Doing a dry run, we quickly run into lots of issues:

First, providing an LLM with an entire schematic file was far too large to fit in the context window.
Here’s an example of a schematic file:
\`\`\`
(kicad\_sch
	(version 20231120\)
	(generator "eeschema")
	(generator\_version "8.0")
	(uuid "55df327d-53d0-46f4-9d9b-076c48b5e587")
	(paper "A4")
	(lib\_symbols
		(symbol "2-INPUT AND:SN74LVC1G08DBVR"
			(pin\_names
				(offset 1.016)
			)
			(exclude\_from\_sim no)
			(in\_bom yes)
			(on\_board yes)
			(property "Reference" "U"
				(at \-12.7 11.16 0\)
				(effects
					(font
						(size 1.27 1.27)
					)
					(justify left bottom)
				)
			)
			(property "Value" "SN74LVC1G08DBVR"
				(at \-12.7 \-14.16 0\)
…. (15,000 more lines)
\`\`\`
These files quickly explode in size and have lots of metadata that may not be needed for us to predict the next state, and will not fit in the context window of most LLMs when augmenting our data. Worse, this metadata may confuse the attention of our final predictive model and introduce extra noise, being harmful. The problem only compounds on the output tokens of the augmenting LLM: We need the LLM to recreate the entire schematic at each stage, causing an insane amount of hallucinations.

### Reducing context size to make generation easier

We fix this by simplifying the input/output expectation of the LLM.

For input: We create a strip\_kicad file that simplifies the kicad file into just the key parts and connections, reducing the context window 20x or more. We remove wire positionings, labels, metadata, and any unnecessary details. An added benefit to this is we can rewrite the output to be much more LLM-friendly by describing connections in a text-friendly format. Here’s a snipped example:

6,857→119 lines (57.5x reduction\! Probably a \~40x reduction in context window)
\`\`\`
\--- Stripped KiCad Output \---
COMPONENTS:
  C14 | 100n | Device:C | uuid=0e7a1b41
    pin 1 (\~) \[Passive\] \-\> \+3.3V
    pin 2 (\~) \[Passive\] \-\> GND
  C15 | 100n | Device:C | uuid=886ba49a
    pin 1 (\~) \[Passive\] \-\> \+3.3V
    pin 2 (\~) \[Passive\] \-\> GND
  C2 | 10u | Device:C | uuid=7e2af52f
    pin 1 (\~) \[Passive\] \-\> VBUS
    pin 2 (\~) \[Passive\] \-\> GND
  ….. 95 lines
NETS:
  \+3.3V \[POWER\]: C14.\~(1)\[Passive\], C15.\~(1)\[Passive\], J2.Pin\_4(4)\[Passive\], R7.\~(1)\[Passive\], U1.3V3(P$8)\[BiDi\], U3.VDD(6)\[PowerIn\], U3.VREGIN(7)\[PowerIn\]
  DHT11 \[SIGNAL\]: J2.Pin\_3(3)\[Passive\], U1.GPIO4(P$16)\[BiDi\]
  GND \[POWER\]: C14.\~(2)\[Passive\], C15.\~(2)\[Passive\], C2.\~(2)\[Passive\], C4.\~(2)\[Passive\], C5.\~(2)\[Passive\], D2.\~(1)\[Passive\], D3.\~(1)\[Passive\], D4.\~(1)\[Passive\], J1.GND(5)\[PowerIn\],
…. 11 lines
\`\`\`

For output, instead of asking the LLM to generate entire schematic states at each step, we ask it to generate a sequence of user actions. Since we have the original file, we can reconstruct it ourselves by matching the sequence and the full file. We’ll recreate the full schematic file from each step of the lineage.

This somewhat works\! Given a prompt to Gemini 3.1 Pro preview:
\`\`\`
Create a complete, human-like schematic construction lineage from the final reduced schematic.

Output only ADD, CONNECT, and NO\_CONNECT actions inside one \`\`\` code block. No prose.

Use UUIDs only. Do not use refs like R25 or U3. Do not invent UUIDs.

Syntax:
ADD uuid=\<component\_uuid\>

CONNECT uuid=\<component\_uuid\>:\<pin\_id\> NET \<net\_name\>
CONNECT uuid=\<component\_uuid\>:\<pin\_id\> uuid=\<component\_uuid\>:\<pin\_id\> ... NET \<net\_name\>

NO\_CONNECT uuid=\<component\_uuid\>:\<pin\_id\>
NO\_CONNECT uuid=\<component\_uuid\>:\<pin\_id\> uuid=\<component\_uuid\>:\<pin\_id\> ...

Rules:
\- Every component must be ADDed exactly once.
\- Every connected pin must be CONNECTed exactly once to its exact final net.
\- Every NO\_CONNECT pin must be included.
\- Omit UNCONNECTED pins.
\- Every CONNECT line must contain the NET sentinel before the net name.
\- Do not output partial lines, comments, ellipses, headings, or markdown other than the one code block.
\- You may batch multiple CONNECTs on one line only when they share the same action/net.
\- ADD one component per line.
\- Make the order human-like by grouping functional blocks. Within each block, humans usually add a small set of parts and connect them before moving on.

Examples:
ADD uuid=d48a925e
CONNECT uuid=d48a925e:1 uuid=5d7f1129:A6 uuid=5d7f1129:B6 NET USB\_D+
NO\_CONNECT uuid=316fc54f:6 uuid=316fc54f:8 uuid=316fc54f:9

Final reduced schematic:
\<SCHEMATIC\_HERE\>

Generated, accurate, human-likely construction lineage:
\`\`\`

It creates something like:
\`\`\`
ADD uuid=b1b0c15e
CONNECT uuid=b1b0c15e:6 uuid=b1b0c15e:7 NET \+3.3V
CONNECT uuid=b1b0c15e:29 uuid=b1b0c15e:3 NET GND
NO\_CONNECT uuid=b1b0c15e:1 uuid=b1b0c15e:12 uuid=b1b0c15e:13 uuid=b1b0c15e:14 uuid=b1b0c15e:15 uuid=b1b0c15e:16 uuid=b1b0c15e:17 uuid=b1b0c15e:18 uuid=b1b0c15e:19 uuid=b1b0c15e:2 uuid=b1b0c15e:20 uuid=b1b0c15e:21 uuid=b1b0c15e:22 uuid=b1b0c15e:23 uuid=b1b0c15e:24 uuid=b1b0c15e:27 uuid=b1b0c15e:28
ADD uuid=4db25211
CONNECT uuid=4db25211:P$8 NET \+3.3V
CONNECT uuid=4db25211:P$16 NET DHT11
CONNECT uuid=4db25211:P$1 NET GND
CONNECT uuid=4db25211:P$6 NET GPIO0
CONNECT uuid=4db25211:P$2 uuid=b1b0c15e:25 NET RXD
CONNECT uuid=4db25211:P$3 uuid=b1b0c15e:26 NET TXD
CONNECT uuid=4db25211:P$9 NET VBUS
NO\_CONNECT uuid=4db25211:P$10 uuid=4db25211:P$11 uuid=4db25211:P$12 uuid=4db25211:P$13 uuid=4db25211:P$14 uuid=4db25211:P$15 uuid=4db25211:P$4 uuid=4db25211:P$5 uuid=4db25211:P$7
ADD uuid=0e7a1b41
CONNECT uuid=0e7a1b41:1 NET \+3.3V
CONNECT uuid=0e7a1b41:2 NET GND
ADD uuid=886ba49a
CONNECT uuid=886ba49a:1 NET \+3.3V
CONNECT uuid=886ba49a:2 NET GND
ADD uuid=7e2af52f
….
\`\`\`

Which is mostly valid\! But, there is a few issues.

1. Hallucinations \- the LLM is still prone to missing connections, creating invalid schematics, and forgetting syntax.
2. Cost \- we are roughly paying 20 cents per call to gemini api \-- over 10,000 examples cost will add up.
3. Does not cover all permutations \-- multiple different routes exist to create the same final schematic, and many are valid/likely human paths to do so. By calling an LLM to generate a human path, it only creates 1 path, which forces the model to memorize an order that may change between training examples with no clear reason, confusing and a lack of generalization.

### Generating lineages in a “smarter” way: constrained permutations

We started by considering 2 alternate approaches: dropping and masking, and BFS/DFS deterministic generation of lineages.

Dropping and masking involves taking the completed, GitHub-validated kicad\_sch file and then masking certain components or connections. We would train the model to predict the output of the missing component or connection using this training data. The problem with this approach is that the model will only learn to fill in 1 item on mostly complete schematics, and also that the last item may not follow the natural development flow of a human.

The second approach is creating the lineage entirely deterministically. By starting at one main part, ie power, and then running a BFS algorithm to create a somewhat realistic path to complete the schematic. The issue with this again is that it does not properly simulate a human, and training on non-realistic data is going to severely degrade the model's usability.

Finally, we decided on a middle ground:

1. Create a deterministic, guaranteed to be correct lineage given a final GitHub kicad\_sch file (no LLM to generate a lineage)
2. Use an LLM to determine human-like block orderings, and what connections/items are flexible/fixed, and what actions should be grouped as once
3. Use the LLM information and the deterministic lineage to generate lots of valid permutations, covering many training examples that are likely to be human

We need to think of a way to use LLMs to create not hard-coded exact paths, but rather something like a dependency graph that still looks like human orderings, but also deals with batches of human edits, and also blocks by both dependencies but human probability. Let’s think more about step 2, using the LLM and what that looks like.

Thought process 1:
Humans likely design schematics in functional blocks: designing the functional blocks. Within each block, they do certain actions in groups, ie, connect all pins from x to y. These blocks can have multiple orders, and so can each group.

There is a tricky balance between permutating all possibilities and keeping only the human-likely groupings. 5 blocks with 4 flexible groups is 5\! \* (4\!)^5 \= \~840M training, which many of are *likely* not human-traversals\!

Step 1: Generate the functional blocks

- LLM “err on side of putting things as fixed. anything a human would highly likely do in an order, fix it. If smth is genuinely up to user preference and can be done either way 50-50,, make it a flexible block. Also make sure u are keeping track of dependencies’
- The blocks are like human chunks of workTier 1: The Macro-Block (Functional Units)
- Humans build modularly. They complete (or mostly complete) one functional block before moving to the next. Examples: Power Supply, Microcontroller Core, USB-C Interface, Sensor Array. Batching Rule: High-level isolation. You should rarely mix actions from different macro-blocks unless they are the global nets (like hooking up the main power rail) linking them together.

Ofc some of the permutations might be broken bc of ordering, but we can just discard them bc we have so many anyway.

We notice that hte lineage generated earlier is too verbose and confusing
d=d14efac8:A2 NET GND
CONNECT uuid=d14efac8:A1 NET net\_2
CONNECT uuid=d14efac8:11 NET net\_5
CONNECT uuid=d14efac8:14 NET net\_6
ADD uuid=c870e3bf
CONNECT uuid=c870e3bf:1 NET GND
CONNECT uuid=c870e3bf:2 NET net\_27
ADD uuid=4a236151
CONNECT uuid=4a236151:1 NET GND
CONNECT uuid=4a236151:2 NET net\_18
ADD uuid=6e7352a5
CONNECT uuid=6e7352a5:2 NET GND
CONNECT uuid=6e7352a5:1 NET net\_1
ADD uuid=dee90173

No knowledge what each uuid part actually looks like and its too confusing
Instead lets make it smth the LLM can easily reference with line numbers and actual part names
We resolve the refs, remove library path (noise), and bring in the net names as well to give more context for the LLM.

New:
\--- Generated Lineage \---
01 ADD U1 | ATmega328-P
02 CONNECT U1:22(GND) U1:8(GND) NET GND
03 ADD U2 | LM7805\_TO220
04 CONNECT U2:2(GND) NET GND
05 CONNECT U2:1(VI) NET VI
06 CONNECT U1:20(AVCC) U1:7(VCC) U2:3(VO) NET AVCC
07 ADD Y1 | 16MHz Crystal
08 CONNECT U1:9(XTAL1/PB6) Y1:2 NET XTAL1/PB6
09 CONNECT U1:10(XTAL2/PB7) Y1:1 NET XTAL2/PB7
10 ADD C1 | 22p
11 CONNECT C1:2(\~) NET GND
12 CONNECT C1:1(\~) NET XTAL1/PB6
13 ADD C2 | 22p
14 CONNECT C2:1(\~) NET GND
15 CONNECT C2:2(\~) NET XTAL2/PB7
16 ADD C3 | 100n
17 CONNECT C3:1(\~) NET GND
18 CONNECT C3:2(\~) NET AVCC
19 ADD R1 | 1K
20 CONNECT R1:2(\~) NET net\_20
21 CONNECT R1:1(\~) U1:3(PD1) NET PD1
22 ADD R2 | 2K
23 CONNECT R2:2(\~) NET GND
24 CONNECT R2:1(\~) NET net\_20
25 ADD R3 | 10K
26 CONNECT R3:1(\~) U1:1(\~{RESET}/PC6) NET net\_1
27 CONNECT R3:2(\~) NET AVCC
28 ADD R4 | 330R
29 CONNECT R4:1(\~) U1:13(PD7) NET PD7
30 CONNECT R4:2(\~) NET A
31 ADD R5 | 10K
32 CONNECT R5:1(\~) NET GND
33 CONNECT R5:2(\~) U1:4(PD2) NET PD2
34 ADD R6 | 330R
35 CONNECT R6:1(\~) NET A
36 CONNECT R6:2(\~) NET AVCC
37 ADD J1 | Conn\_01x04
38 CONNECT J1:3(Pin\_3) NET GND
39 CONNECT J1:2(Pin\_2) U1:2(PD0) NET PD0
40 CONNECT J1:1(Pin\_1) NET net\_20
41 CONNECT J1:4(Pin\_4) NET AVCC
42 ADD J2 | Conn\_01x02
43 CONNECT J2:1(Pin\_1) NET GND
44 CONNECT J2:2(Pin\_2) NET net\_6
45 ADD J3 | Conn\_01x02
46 CONNECT J3:1(Pin\_1) NET GND
47 CONNECT J3:2(Pin\_2) NET VI
48 ADD K1 | JQC-3FF-005-1Z
49 CONNECT K1:A2(\~) NET GND
50 CONNECT K1:A1(\~) NET PD7
51 CONNECT K1:11(\~) NET AVCC
52 CONNECT K1:14(\~) NET net\_6
53 ADD D1 | LED
54 CONNECT D1:1(K) NET GND
55 CONNECT D1:2(A) NET A
56 ADD D2 | LED
57 CONNECT D2:1(K) NET GND
58 CONNECT D2:2(A) NET A
59 ADD SW1 | SW\_Push
60 CONNECT SW1:2 NET GND
61 CONNECT SW1:1 NET net\_1
62 ADD SW2 | SW\_Push
63 CONNECT SW2:1 NET PD2
64 CONNECT SW2:2 NET AVCC
\--- End Generated Lineage \---

Ideal output:

FIXED Group 1: Main parts
1 FIXED
1,4,29,53 FIXED

The issue here is that prompting for blocks then ordering those, then prompting for groups within blocks is too complex..

what if we screw the groups/blocks and just made the llm generate groups. each group is what a human would do in 1 liek 4 minute ish chunk. ike connect all pins here. or add and connect this. one suggestion.

then, we ask llm to a) create groups and b) tell me if its flexible fixed and what it depends on, leaning towards fixing as much as possible. Each group doesn tneed to worry about ordering within it

we take it, then we create perms (of group orderings), trim off those perms that are broken

LLM adds description so it also self rationalizes internally and potentially stronger more rational output
Maybe smth liek this

\`\`\`
GROUP 1: Add MCU \+ power pins
FIXED
lines: 0001 0002

GROUP 2: Add voltage regulator \+ wire
FIXED
lines: 0003 0004 0005 0006

GROUP 3: Crystal \+ load caps
DEPENDS ON: 1
lines: 0007 0008 0009 0010 0011 0012 0013 0014 0015

GROUP 4: Relay driver circuit
FLEXIBLE
lines: 0028 0029 0030 0048 0049 0050

GROUP 5: Input switches
FLEXIBLE
lines: 0059 0060 0061 0062 0063 0064

Likely orderings:
1\. Group 1, group2, group 4, group 5, group 3
2\. Group 1, group 2, group 3, group 4, group 5
3\. Group 1, group 2, group 4, group 2, group 1
\`\`\`

Hmm maybe we just

1. Fade groups/blocks
2. Fade creating permutations our selves
3. We just get llm to create groups and determine what is dependent on what, then create a few highly likely orderings
4. We validate it and keep the valid ones and use those

So we need to create a new prompt

\--- LLM Prompt (includes full lineage below prompt text) \---
You are given a linneage that a robot took to create a schematic on KiCad. The robot does NOT necessarily match human behavior.
Your job is 2 fold:
1\. Create human like blocks of work
 \- Humans build modularly. An electrical engineer will work on one functional block at a time, ie, adding and wiring up a decoupling cap, or adding and wiring up a microcontroller, etc.
 \- Each block should not be too many actions at once. It should be something that a human would sit down, think, and then do in 1 go all together as one descriable unit of work
\- Keep tightly coupled actions together, such as adding a component and wiring its local pins.
\- A group should usually be small enough that a human could do it in one focused editing pass.
\- Prefer functional chunks over arbitrary line ranges.
\- Do not create new schematic actions.
\- Do not rewrite schematic actions.
\- Only refer to input line numbers.


2\. Create an ordering of blocks
 \- You need to tell me what a real engineer would most likely do first, second, etc by telling me multiple, highly likely block orderings.
 \- Each of these orderings must also be VALID. They must all still be valid linneages, ie NO connecting pins before the components are added.
 \- You can give me from 1-5 different orderings.

Output Format and rules
    \- return with \`\`\` block for the final answer
    \- Include the Group with description, the line \# from the input, and what it depends on.
    \- Include the LIKELY ORDERINGS, in order of likelihood, that are both CORRECT and VALID but also most human likely.
    \- Reference the line numbers from the input, not anything else. Follow the example format strictly
    \- Make sure to COVER EVERY SINGLE LINE in the input.

GROUP \<id\>: \<short description\>
LINES: \<space-separated input line numbers\>
DEPENDS ON: \<space-separated group ids, or none\>

LIKELY ORDERINGS:
1\. \<space-separated group ids\>
2\. \<space-separated group ids\>
3\. \<space-separated group ids\>

Example output:
\`\`\`
GROUP 1: Add the ATmega328P and establish its ground and power connections.
LINES: 01 02
DEPENDS ON: none

GROUP 2: Add the regulator, connect input/output power, and establish AVCC.
LINES: 03 04 05 06
DEPENDS ON: 1

.. more groups here in an actual output (3-6)

LIKELY ORDERINGS:
1\. 1 2 3 4 6 5
2\. 1 2 4 6 3 5
3\. 1 2 5 3 4 6
\`\`\`

The input linneage:

\`\`\`
01 ADD U1 | ATmega328-P
02 CONNECT U1:22(GND) U1:8(GND) NET GND
03 ADD U2 | LM7805\_TO220
04 CONNECT U2:2(GND) NET GND
05 CONNECT U2:1(VI) NET VI
06 CONNECT U1:20(AVCC) U1:7(VCC) U2:3(VO) NET AVCC
07 ADD Y1 | 16MHz Crystal
08 CONNECT U1:9(XTAL1/PB6) Y1:2 NET XTAL1/PB6
09 CONNECT U1:10(XTAL2/PB7) Y1:1 NET XTAL2/PB7
10 ADD C1 | 22p
11 CONNECT C1:2(\~) NET GND
12 CONNECT C1:1(\~) NET XTAL1/PB6
13 ADD C2 | 22p
14 CONNECT C2:1(\~) NET GND
15 CONNECT C2:2(\~) NET XTAL2/PB7
16 ADD C3 | 100n
17 CONNECT C3:1(\~) NET GND
18 CONNECT C3:2(\~) NET AVCC
19 ADD R1 | 1K
20 CONNECT R1:2(\~) NET net\_20
21 CONNECT R1:1(\~) U1:3(PD1) NET PD1
22 ADD R2 | 2K
23 CONNECT R2:2(\~) NET GND
24 CONNECT R2:1(\~) NET net\_20
25 ADD R3 | 10K
26 CONNECT R3:1(\~) U1:1(\~{RESET}/PC6) NET net\_1
27 CONNECT R3:2(\~) NET AVCC
28 ADD R4 | 330R
29 CONNECT R4:1(\~) U1:13(PD7) NET PD7
30 CONNECT R4:2(\~) NET A
31 ADD R5 | 10K
32 CONNECT R5:1(\~) NET GND
33 CONNECT R5:2(\~) U1:4(PD2) NET PD2
34 ADD R6 | 330R
35 CONNECT R6:1(\~) NET A
36 CONNECT R6:2(\~) NET AVCC
37 ADD J1 | Conn\_01x04
38 CONNECT J1:3(Pin\_3) NET GND
39 CONNECT J1:2(Pin\_2) U1:2(PD0) NET PD0
40 CONNECT J1:1(Pin\_1) NET net\_20
41 CONNECT J1:4(Pin\_4) NET AVCC
42 ADD J2 | Conn\_01x02
43 CONNECT J2:1(Pin\_1) NET GND
44 CONNECT J2:2(Pin\_2) NET net\_6
45 ADD J3 | Conn\_01x02
46 CONNECT J3:1(Pin\_1) NET GND
47 CONNECT J3:2(Pin\_2) NET VI
48 ADD K1 | JQC-3FF-005-1Z
49 CONNECT K1:A2(\~) NET GND
50 CONNECT K1:A1(\~) NET PD7
51 CONNECT K1:11(\~) NET AVCC
52 CONNECT K1:14(\~) NET net\_6
53 ADD D1 | LED
54 CONNECT D1:1(K) NET GND
55 CONNECT D1:2(A) NET A
56 ADD D2 | LED
57 CONNECT D2:1(K) NET GND
58 CONNECT D2:2(A) NET A
59 ADD SW1 | SW\_Push
60 CONNECT SW1:2 NET GND
61 CONNECT SW1:1 NET net\_1
62 ADD SW2 | SW\_Push
63 CONNECT SW2:1 NET PD2
64 CONNECT SW2:2 NET AVCC
\`\`\`
\--- End LLM Prompt (includes full lineage below prompt text) \---

\--- LLM Response (attempt 1\) \---
\`\`\`
GROUP 1: Add the ATmega328P microcontroller and establish its ground connection.
LINES: 01 02
DEPENDS ON: none

GROUP 2: Add the LM7805 voltage regulator and connect its power nets to the MCU.
LINES: 03 04 05 06
DEPENDS ON: 1

GROUP 3: Add the 16MHz crystal oscillator and its load capacitors.
LINES: 07 08 09 10 11 12 13 14 15
DEPENDS ON: 1

GROUP 4: Add the decoupling capacitor for the AVCC line.
LINES: 16 17 18
DEPENDS ON: none

GROUP 5: Add the UART communication header and its TX logic-level voltage divider.
LINES: 19 20 21 22 23 24 37 38 39 40 41
DEPENDS ON: 1

GROUP 6: Add the MCU reset circuit (pull-up resistor and push button).
LINES: 25 26 27 59 60 61
DEPENDS ON: 1

GROUP 7: Add the LED indicators and their current limiting resistors.
LINES: 28 29 30 34 35 36 53 54 55 56 57 58
DEPENDS ON: 1

GROUP 8: Add the user input push button and its pull-down resistor.
LINES: 31 32 33 62 63 64
DEPENDS ON: 1

GROUP 9: Add the relay circuit and its output terminal block.
LINES: 42 43 44 48 49 50 51 52
DEPENDS ON: none

GROUP 10: Add the main power input terminal block.
LINES: 45 46 47
DEPENDS ON: none

LIKELY ORDERINGS:
1\. 1 10 2 4 3 6 5 8 7 9
2\. 10 1 2 4 3 6 7 9 8 5
3\. 1 3 6 2 4 10 8 7 9 5
\`\`\`

### Creating usable training data

worry
\- IF LLM approach we need to make text not be differnet labels each time, ie net names need to be consistnat no? and need a way to consistnaize it

\- we need to keep the blocks in the output linneages format

We need both for GNN approach and for the normal approach

We also need to add in UUID into this asw

Final prediction needs to be like:

BATCH:
Add uuid x
attach wire from UUID x to UUID y

So we need to keep batches and uuids in our training set

Realize order within a output (of a batch, like what item the llm first outputs) doesnt lry matter cuz they all will be shown as one in a ghost preview.

\---------
We created LLM data by each input/output pair can be created per line of the lineage

Issue \#1:
 \- we have the first prediction is off an empty field. This means it has nothing ot base its prediction off
Solution: we just remove the first

Issue \#2:

- me input mapping to different outputs.
- Examples:
- {"input": "", "output": "ADD U3 ..."}
- {"input": "", "output": "ADD C14 ..."}
-
- and:
- input \= ADD U3 ...
- output \= ADD U1 ...
-
- but elsewhere:
- input \= ADD U3 ...
- output \= ADD J1 ...
-
- For SFT, that is contradictory supervision. A big model can maybe learn “many things are valid next,” but a tiny model will get mushy. Either keep one ordering per schematic, or add something like:

No solution

Issue \#3
UUIDs cloud the LLM model
 my worry is if i remove UUIDs i cannot do the inference on the frontend UI to actually do connections. cuz how will it know

do we do this?

Make refs canonical before training:

U\_USB\_UART

U\_MCU

J\_USB

R\_RST\_PULLUP

C\_3V3\_DEC\_1

in that case we can remove UUIDs from the training data right cuz we can always back match it

codex://threads/019e3c47-aaf0-7ca1-8126-026897d3cd4e

We can basically remove UUIds

# Training

\-- question: how to reward not even if took a path that is plausible? Multiple correct answers?
We use

Consider the LLM vs GNN model
GAT / only subgraph with distance 3 of touched
→ also what is our node/edge structure looking like: holding how recently touched asw
We can have a score on each node OR edge (since you couldve last done a item or connection) of how recently edited. We can also have score on last selected item as is\_selected \= true on the node

Size generation issue

LLM density / vram issue
Context window
Inferenc epseed
Training cost
Time till first token
Low latency
Try to run on device

Last 3 actions touched could be useful

Interesting thought here
[https://thakkarparth007.github.io/copilot-explorer/posts/copilot-internals](https://thakkarparth007.github.io/copilot-explorer/posts/copilot-internals)
[https://cursor.com/blog/tab-rl](https://cursor.com/blog/tab-rl)
Cursor basically uses a 2nd model to predict if it will be accepted or not
And a first model to predict users next move
Since its hard to train 1st model to NOT predict sometimes

\--\> gnn might solve issue of text representing schematic poorly, \+ how physical ordering doesnt matter of items, only connections matter

1. And how to get GNN to guess what to add and what to connect (2 diff things , edge predict vs node predict)

Faster inference, more accurate since problem is basically graph rpoblem

# Inference

If we went LLM route:

1. Have high KV cache since the current state will be repeated or 90% similar each time
2. We can have speculative decoding like how morph does it using OG code as predictive if we use LLM since most of the map will remain the same (this is LLM with regen full map case only)
3. Can we get tiny enough model to run on device? Or run extremely fast?

Caching only do inference when new state
Only generate diffs

Speculative speculative chain on next thing as soon as high likely accept suggestion shown

Online RL
Out model just predicts next action, we algoritmicslaly figure out UI / best place to place it

Need to be blazingly fast (\<100ms latency)

# Questions to ask tejas

So we are currently doing this:

1. Taking complete kicad\_sch files, stripping away everything non-essential (labels, metadata, x,y coords)
2. Generating a deterministic lineage, ie:

   ADD component x
   CONNECT pin x to pin y
   ADD ..
   Etc etc


Thinking of getting an LLM to gen human-likely lineage ordering of the above (what can be reordered safely, what is likely to come before something else, how much to batch certain stuff, what stuff goes together)

Then we can permutate all the elements that can be reordered to cover all training examples / generalize? Or should we do like different loss function or RL in which it gets reward for all correct answers? Effect on the final output being ‘human-like’?

The issue is multiple human-likely lineages exist and are valid so not sure how to account for all that.

Another question is the actual model \-- thinking of GNN because the graph can model the connections and elements on a schematic perfectly compared to LLM (line-by-line generalization issue). Then we can do smth like give more weight to the edges/nodes that are more recently touched/actioned by user.

# Ideas

\-- train github commits to help w augmenting progress

* path:\*.kicad\_sch*/ }),
  },
  {
    slug: "speculative-decoding-first-principles",
    title: "Decoding Speculative Decoding from First Principles",
    date: "2026-07-07",
    category: "Engineering",
    summary: "Walking through the history of speculative decoding papers, from Leviathan's original drafter/verifier trick through tree-based verification and diffusion drafters, and what might be next.",
    markdown: markdown(() => { /*

# Decoding Speculative Decoding from First Principles

By: Shrey Birmiwal

# Abstract

In this blog, I'm going to try to explain speculative decoding in simple language by walking through the history of speculative decoding papers, because I think speculative decoding is really, really cool and isn't talked about enough. I'm going to try to share the current state of speculative decoding and what's possible next.

**TLDR:** Speculative decoding allows you to get up to 8x speedups on LLM workloads completely lossless, and is pretty close to a free lunch in inference.

# Prereq knowledge on autoregressive language models and hardware

Large language models work like this:

![][image2]

Old tokens + KV is fed through the model to predict the new token and KV. This is done in an iterative loop to keep generating next tokens. This loop needs to run even when reading the user's query (though the predicted next token is discarded).

Where token is the word outputted, and KV is the cumulative knowledge of the sentence that gets iteratively built up.

You should observe that generation is sequential. Token #50 depends on token #49 which depends on token #48 and so forth. This is why you see ChatGPT streaming one token generation at a time (autoregressively), and not in huge chunks of text. (If interested, learn more about causal masked attention and [diffusion text models](https://en.wikipedia.org/wiki/Diffusion_model)).

When trying to optimize LLMs to run on GPU hardware, we look at the most barebones operations that the GPU has:

- The compute: the amount of floating point math operations the GPU can compute, per second (FLOP/s)
- The memory bandwidth: the amount of bytes the GPU can load from the HBM VRAM into the SRAM / SMs (the actual compute cores)

We can naively calculate the amount of time a task takes as the sum of memory time + compute time. In this model, it seems like we should always try to optimize both the amount of compute and the bandwidth speed of GPUs.

$$T_{\text{step}} = \text{Time loading} + \text{Time compute}$$

In reality, GPUs are massively parallel processors. All the operations become interwoven between loading items and computing them, so with pipelining the wall-clock time can be approximated to just the time of the slower operation. The time taken to complete an operation really becomes:

$$T_{\text{step}} = \max\Big(\underbrace{\textstyle\sum \text{bytes loaded (weights + KV)}}_{\text{memory time}},\ \underbrace{\textstyle\sum \text{FLOPs}}_{\text{compute time}}\Big)$$

In this model, we should focus on reducing the bottleneck and ensure that the time taken to load the weights is never more than the time to compute (never want to be memory bound).

The key number to watch is called arithmetic intensity: the amount of math being computed per byte loaded (kinda measuring the compute bound:memory bound ratio).

$$\text{Arithmetic Intensity} = \frac{\text{amount of work (FLOPs)}}{\text{amount of bytes loaded}}$$

The roofline analysis model makes it easy to see:

![][image3]

As arithmetic intensity increases, the amount of work done increases until you reach a point of being compute bound (memory is no longer the bottleneck). The horizontal axis is the arithmetic intensity and the vertical axis is the amount of usable work completed. You can see, as we increase the arithmetic intensity we can increase the amount of work done. This is because in the rising zone, we are memory bound, and improving the amount of compute that can be done per memory load increases total work. At a certain point, (the ridgepoint), we flip from being memory bound to compute bound. So, increasing the amount of work you can do per loaded byte doesn't improve anything since memory bandwidth is no longer the bottleneck.

At point A, we need to load the entire knowledge of the text and the model weights to create just 1 new token, then repeat it again. So, the arithmetic intensity is very low:

$$\text{arithmetic intensity} = \frac{1 \text{ new token}}{\text{model weights} + \text{KV}}$$

Our goal is to move toward point B, the ridgepoint, so we are optimally using all the compute we have available. So, our guiding question/goal is to move our traditional LLM processing from point A to point B by increasing arithmetic intensity, by primarily increasing the parallelism.

## Parallelizing method 1: batch parallel

Two terms we need to clearly understand: Latency and throughput.

Latency is the time in between tokens per user. Having lower latency is better, since users see tokens faster.

Throughput is the total amount of tokens we produce per second. Having higher throughput is better because we are producing more tokens for more global users.

These don't always scale together. Increasing throughput may likely mean we make latency per user worse. For example, increasing concurrency (called batch size) often means that the latency is higher (worse) per user, while total throughput increases.

![Latency is flatish until the ridgepoint as you increase concurrency. Throughput flattens once compute bound.][image4]

This graph shows the relationship between batch size and throughput and latency. By increasing batch size, we can parallelize and increase the arithmetic intensity, as shown by the equation below.

$$\text{arithmetic intensity} = \frac{B}{W + \text{KV} \cdot B}$$

Since we increased the number of tokens by a factor of B and the divisor weight factor remained constant (shared weights amongst all batch members), we increased the arithmetic intensity. Batch size helps amortize the cost of loading the weights from HBM to SRAM/SMs.

In the above graph of batch size vs throughput, you'll see that it matches the roofline model since batch size increases arithmetic intensity. Latency also follows this model (just inverted, lower latency is better). To the left of the ridgepoint, latency gently increases because as batch size increases, the memory KV load increases (albeit at a slower rate than the total compute rising, due to the amortization of weights). To the right of the ridgepoint, we are now compute bound, and increasing batch size just increases the amount of work to be done linearly.

This also answers why we don't want to go to point C (all the way to the right in the roofline analysis chart). Going to point C is the same as point B (the ridgepoint) in terms of throughput (we can produce the same # of tokens, we are limited by the amount of compute we have!). However, latency (the individual user tokens per second) starts to suffer significantly.

There is another issue: GPUs are limited in memory capacity in the HBM. If we increase the batch size, we need more space to store the KV (memory is very expensive), which eventually runs out.

So while increasing batch size is a good trick we should be aware of:

- It does not amortize the cost of the KV loading (because KV is private to each sequence)
- It increases latency per user
- It cannot scale forever because of KV memory limits in HBM

## Parallelizing method 2: sequence parallel

It is true that the mental model of sequential generation is always used in large language models. Even when the next token is known (for example, when parsing the input prompt), you still need to do the work (not to predict the next token, we already know what comes next) but so the model can create an internal representation to understand the input (the KV).

![Prefill is parallel while decode is sequential process.][image5]

You can compute the probabilities of the next few tokens all at once, if you know what is coming next. For example, if I pass in 5 tokens at once "Hi my name is shrey," the model can generate the probabilities of each word AND the KV completely parallel. This first part of LLM inference (reading the input prompt) is called the prefill stage. It is fully parallelizable because every input token is already known, nothing is forcing the model to wait. It can shove the entire prompt at once and understand it using this sequence parallelism.

The generation of new tokens (decode) is what is sequential. Since we don't know the next token, we need to do the generation to repeat the loop with our predicted token. Each turn's input is the previous output, so we have to do one token per forward pass (low arithmetic intensity, memory bound), wasting idle GPU resources.

Let's do the arithmetic intensity math on the prefill. It is generating S sequence tokens, and loading in the weights + KV for that sequence. We can also combine sequence parallelism with batch parallelism, by outputting S\*B tokens whilst loading 1 shared weights and a per batch KV.

$$\text{arithmetic intensity} = \frac{S}{W + \text{KV}} \qquad \text{with batching:} \quad \frac{S \cdot B}{W + \text{KV} \cdot B}$$

So you can see that sequence parallelism amortizes not only the weights, but also the KV, since per each request the unique KV gets shared across the entire sequence. With batch parallelism, we could only amortize the weights.

One of the key components of the forward LLM pass is a method called attention. This is an O(n^2) operation, where each new token needs to attend to all the previous tokens. So, combining the parallelism of prefill with this O(n^2) operation very quickly makes prefill compute bound. Techniques like sparse attention reduce this O(n^2) component, but that's for another blog.

![Decode is memory bound, prefill is compute bound (due to the sequence parallelism and attention).][image6]

Batching and sequence parallel both climb the roofline, but batching only amortizes weights while sequence parallel amortizes the shared KV loading as well.

# Speculating to get sequence parallelism during decode

The original paper by Leviathan '23 on speculative decoding [can be found here.](https://arxiv.org/pdf/2211.17192)

We know that prefill can be parallelized, increasing arithmetic intensity, shifting from memory bound (bad) to compute bound (good). The question is how can we use this prefill verification trick during decode? The issue is that in prefill we knew the next tokens. We don't have a clue what's coming next in decode.

Leviathan solves this using a draft model, and borrows ideas from CPU speculative branching (guessing a branch before you know to prevent idling). The idea is simple: Before the target (main) model generates, run a tiny, fast, draft model which is autoregressively outputting tokens. I won't get into how the drafter is trained, but it's just trained to try to copy the main model. Since it's tiny, generating even 5 tokens is almost free and instant. Use these as the guess "next few tokens" so we can parallel verify.

The target model follows the prefill trick to verify all the draft tokens. At the first disagreement, the target can reject the draft's answer and keep its own. The last output of the verification pass is the prediction for the token in the n+1 position. In this way, we call this a +1 bonus token because the forward pass will always give us between 1 and n+1 correct tokens.

![Drafter / verifier process allows verifier to correct mistake and give bonus.][image7]

The number of tokens created has increased, while the bandwidth pressure remains constant:

$$\text{arithmetic intensity} = \frac{\text{correctly guessed tokens}}{W + \text{KV}}$$

This pushes us closer toward compute bound on the roofline analysis:

![Speculation moves decode closer to the ridgepoint by increasing the arithmetic intensity.][image8]

One stipulation: If we are running high enough batch size such that we are already compute bound before speculating, the additional cost of speculating comes as straight negative costs.

Costs (ignored when memory bound, paid heavily when already compute bound):

- Cost of verification -- the increase in arithmetic intensity cost linear with the amount of tokens we generated. In other words, even though 3x tokens speculated, 3x work done
- Cost of the speculator -- the cost of the actual speculation computed on the same GPU was straight loss!
- The latency of the speculator purely is additive to the total latency, because it runs before the actual verification pass

This is why it is important to balance the following, since they are all related in ways:

- The footprint of the speculator (don't want the speculator to use more than the free left over compute!)
- The acceptance rate / length of the speculator (too short/inaccurate, and the verification cost starts showing up!)
- The latency of the speculator
- Only running the speculator when you are memory bound, not compute bound

## How does this drafter maintain the same distribution of the target?

Verification is a neat trick as well. Verification maintains that the final output has the exact same distribution as the target model through [rejection sampling](https://en.wikipedia.org/wiki/Rejection_sampling). All autoregressive models, (both the target and the drafter) output a distribution of probabilities as their prediction for the next token. So if your vocabulary was ["hi", "hello", "hey"], a model could output [.5, .3, .2] and a drafter could produce [.2, .7, .1] and so on. Generally, LLMs sample from this distribution using rules like temperature, top-k, top-p, etc in a random way.

Let's see how it plays out with speculation, with p(x) the target probability for token X, and q(x) as the draft probability for token X:

$$\text{accept } x \text{ with probability } \min\Big(1, \frac{p(x)}{q(x)}\Big)$$

Case 1, p(x) > q(x): Drafter is less confident on its selected particular token than the target model, and we should always accept the drafter.

The intuition is that if we randomly sampled from the drafter, and picked something with a lower probability than the ground truth, we would've likely sampled the same token if we only had the target model anyway, and have no risk of over-representing relative to the target true distribution.

Case 2: p(x) < q(x): Drafter is overconfident on a selected particular token, and we should accept only p/q times, and for the rest, sample from the residual.

In this case, the drafter has put confidence on a part of the distribution that the target model would not have. This sounds like bad news, but realize, even the target may output tokens outside the top distribution sometimes. So, we accept the drafter p/q times. When we reject, 1-p/q, we sample from the residual distribution that the target wanted but the drafter put less probability mass on.

Here's an example:

Vocabulary = ["hi", "hello", "hey"]

$$p = [.5,\ .3,\ .2] \qquad q = [.2,\ .7,\ .1]$$

The draft selected "hello," but the target would have only written "hello" 30% of the time. So, we accept "hello" .3/.7 = .43 times. On the remaining .57 times, we reject and sample from the residual:

$$\max(p-q, 0) = [.3,\ 0,\ .1] \ \rightarrow\ \text{normalize} \ \rightarrow\ [.75,\ 0,\ .25]$$

And sample from this, so likely "hi."

### Proving the same distribution

The probability of proposing q(x) and accepting min(1, p(x)/q(x)) together is below, and can be simplified by multiplying through:

$$q(x) \cdot \min\Big(1, \frac{p(x)}{q(x)}\Big) = \min(q(x), p(x))$$

The probability of something got proposed, rejected, then residual picked x:

$$\underbrace{\Big(\textstyle\sum_{x'} q(x')\big(1-\min(1, \tfrac{p(x')}{q(x')})\big)\Big)}_{\text{how often we reject at all}} \cdot \underbrace{p_{\text{residual}}(x)}_{\text{given a rejection, chance we draw } x}$$

Multiply out the first term and expand the definition of the residual:

$$\frac{\Big(\textstyle\sum_{x'} \max(q(x')-p(x'),\ 0)\Big) \cdot \max(p(x)-q(x),\ 0)}{\textstyle\sum_{x'} \max(p(x')-q(x'),\ 0)}$$

which *super cool* cancels out to max(p(x)-q(x), 0) because p-q will be the same as q-p over the entire distribution (since p and q each sum to 1).

The total probability of picking token x is equal to the sum of the proposing and accepting, plus rejecting and residual:

$$\underbrace{\min(q(x), p(x))}_{\text{overlap (Path 1)}} + \underbrace{\max(p(x)-q(x),\ 0)}_{\text{leftover (Path 2)}} = p(x)$$

This can be seen by trying both cases (p<q or q<=p) — we sum p + 0 or q + (p-q).

$$\text{If } p(x) \geq q(x): \quad \underbrace{q(x)}_{\text{overlap}} + \underbrace{(p(x)-q(x))}_{\text{leftover}} = p(x)$$

$$\text{If } p(x) < q(x): \quad \underbrace{p(x)}_{\text{overlap}} + \underbrace{0}_{\text{leftover}} = p(x)$$

Using this really cool rejection sampling math, we mathematically guarantee a LOSSLESS identical distribution of output between accepted drafts and original target outputs.

# Advances in speculators

I chose below a few papers that I found brought interesting advances to speculative decoding and highlight them grouped below. Leviathan's original speculative decoding worked and proved speculators as a concept, but the below papers have trained different architectures to lead to much higher speedups.

## Better drafters

**Medusa** ([Cai '24](https://arxiv.org/pdf/2401.10774)): Medusa finds that having an entirely separate drafter model can cause the drafter to drift off-policy from the target model. Instead of training a separate autoregressive model, it bolts on a few extra decoding heads on the last layer of the target model (after the main model is done training). The heads predict N+1, N+2, N+3 etc tokens ahead (1 token each). Found to have an up to 3.5x speedup on inference in coding workloads. The idea comes from MTP: a training technique where the model is told to predict multiple tokens ahead, so the model is forced to output tokens with long term thinking and not just the next statistically most probable token. The weakness of this model is that each head is independent. The head predicting N+2 is not knowledgeable of the N+1 prediction, which hurts the max acceptance rate / length of the model.

**Eagle 1** ([Li '24](https://arxiv.org/pdf/2401.15077)): Eagle found that simply bolting onto the last layer isn't enough. The key insight is that "the target knows best." This means the target model's hidden states already have a lot of context about the next few tokens, so we should use that, passing the model's features into the drafter. The acceptance rates jump ~5-10% compared to Medusa.

**DFlash** ([Chen '26](https://arxiv.org/pdf/2602.06036)): As the above drafters got better and better, and the acceptance rate increased, people started increasing the amount of tokens generated by drafters, which increased the latency from the actual drafter. DFlash solves this by switching the model architecture of drafters from autoregressive to block [diffusion models](https://en.wikipedia.org/wiki/Diffusion_model). Diffusion models denoise entire blocks of masked tokens in one forward pass, which causes hardly any increase in latency for longer text blocks, leading to a 6x lossless speedup. One weakness is that diffusion models generate each token somewhat independent of each other, so we get the same problem of Medusa/MTP showing up again.

## Tree based verification

**SpecInfer** ([Miao '23](https://arxiv.org/pdf/2305.09781)): In Leviathan's draft model, if the draft is wrong on a certain token, the entire sample has to be rejected after that point. In the case that the drafter is 50-50 uncertain on a certain token, the future tokens hinge on getting lucky at an earlier position. SpecInfer says: don't guess one sequence, guess a tree, branching into multiple continuations, and check them all. SpecInfer creates "tree attention," the method of checking all branches of the tree in parallel by only relating branches back to the parent's lineage when calculating the next token distribution.

**Eagle 2** ([Li '24](https://arxiv.org/abs/2406.16858)): Eagle 2 adds tree based verification on top of Eagle 1. Furthermore, it creates dynamic trees: it goes deeper on branches with more confidence and wider/more shallow when less confident.

**DDTree** ([Ringel '26](https://arxiv.org/pdf/2604.12989)): DDTree applies tree based verification to the DFlash diffusion block drafter. It is interesting to point out how the matrix sampling method works. The diffusion model outputs the probability of each token, and creates branches by sampling the most probable branch until the max prediction token limit is hit.

![Using cumulative probabilities to have varied length branches.][image9]

You can see above by multiplying the probabilities through the graph, we take the longest, highest probability branches first and stop going deeper as soon as a shorter branch has higher joint probability. This pushes speedups to 7-8x on certain workloads, and even at the same total token total as DFlash, has a higher speedup (because it can capture shallower paths that might've been missed by DFlash).

# Some ideas on what's next

- **Speculation to increase throughput, not latency:** Speculation is typically used at lower batch sizes, when you are memory bound. But for long running agents, at longer context (KV) even large batch sizes flip to memory bound. [This is an interesting blog](https://www.together.ai/blog/speculative-decoding-for-high-throughput-long-context-inference) by [@togethercompute](https://x.com/togethercompute) that uses speculative decoding (with the same target and draft model, just at limited KV size through a sliding window) to increase throughput 2x.
- **Completely disaggregating the speculator:** One of the costs we discussed was the cost of the speculator itself: it hogs memory bandwidth and compute. With chips like [@taalas_inc](https://x.com/taalas_inc) and [@Etched](https://x.com/Etched) shifting toward more specialized inference, curious if we can use a specialized chip running a tiny model as a sidecar to the GPU running the target model.
- **MoE speculation:** Mixture of Experts is a type of model architecture where models only activate a small portion of total parameters per token, changing the landscape of memory vs compute. Routing aware drafters?
- **Speculators that use MoE as an architecture themselves:** As the target model becomes more and more experts, curious if the speculator itself becomes a tiny MoE? To help stay on policy.
- **Routing to different speculators by workload:** Code, general text, and data analysis have very different styles of text. Since the drafter is a tiny model, specialization improves the quality. Perhaps routing and tuning to a specific drafter after the prefill (using a linear layer head on the KV of the final token to classify?) could improve the accepted token length.
- **Online training of speculators for zero data retention + hidden states already on hand:** Training speculators requires having on-policy data (data that has been run through the target model for the hidden states + final correct output), as well as permission from customers to train on such data. [@baseten](https://x.com/baseten) has [published some cool](https://www.baseten.co/blog/live-draft-model-training-for-speculative-decoding/) work showing you can train a speculator whilst serving the target model to customers, with the data never leaving the RAM and not affecting production latency. [@modal](https://x.com/modal) is also working on specialized speculators per customer workload.

**DSpark** ([DeepSeek '26](https://arxiv.org/html/2607.05147v1)): The newest DeepSeek speculative decoding paper. Improves upon DDTree. It's at the top of my reading list!

Thanks for reading! Thanks to [@tejasybhakta](https://x.com/tejasybhakta) and [@charles_irl](https://x.com/charles_irl) for all the help answering my questions learning about this topic! I started learning about LLMs and speculation just recently, so please correct any mistakes I made, I really would love to learn more. I wrote this as a forcing function (as Charles would say) to formalize my intuition on speculative decoding.

*/ }),
  },
  {
    slug: "infer-sim",
    title: "Infer-Sim: An open-source simulator for routing algorithms and cache policies for inference workloads",
    date: "2026-07-21",
    category: "Engineering",
    summary: "A lightweight simulator for replaying inference workloads, testing routing and cache policies, and visualizing latency, TTFT, utilization, cache hits, and queue behavior before pushing changes to production.",
    markdown: markdown(() => { /*

# Infer-Sim: An open-source simulator for routing algorithms and cache policies for inference workloads

By: Shrey Birmiwal

# Motivation

![Infer-Sim interface][image1]

During my time at Morph, one recurring problem was how hard it was to test ideas for inference optimization. Trying a new routing or caching theory often meant pushing code to production, then waiting days to see whether latency improved. Raw logs also made bottlenecks difficult to understand; it was easy to miss a growing queue or struggle to pinpoint why TTFT or latency spiked.

Many inference behaviors only show up under realistic live traffic patterns. That makes them hard to backtest, because inference engines have many tunable parameters and those parameters interact in complex ways.

The goal of this lightweight simulator is to emulate and quickly test different configurations. You can tune any of the following:

1. Mooncake compatible trace dataset and query arrival rate
2. LLM model settings such as quantization parameters and layers
3. Batch size
4. Router policy such as cache aware custom and round robin
5. GPU cluster configuration including custom bandwidth and FLOP specs

You can visualize any of the following:

1. Mean and p95 latency TTFT
2. Cache hits
3. Node utilization
4. Replay the GPU routing decisions
5. Backlog queue
6. Peak queue size

# How we approximated each variable

## Requests

Requests are replayed from a Mooncake-compatible trace format. Each row includes arrival time, input length, output length, and prefix block hashes.

The arrival gaps can be scaled to stress the system:

```text
arrival_time = recorded_arrival_time * ARRIVAL_SCALE
```

Lower arrival scale means a hotter replay. Higher arrival scale means a calmer replay.

## Prefix Cache

Prompts are represented as blocks. Two requests share a prefix when their leading block hashes match.

For each request, the simulator finds the longest cached prefix available from:

- local HBM
- local host RAM
- peer node over RDMA
- disk

It uses the cached prefix only when loading it is faster than recomputing it.

## Prefill

Prefill is modeled as compute-bound:

```text
prefill_time = 2 * active_params * tokens / (flops * MFU)
```

This captures the intuition that long prompts are expensive because the model has to process every input token.

## Decode

Decode is modeled as memory-bound across the active batch:

```text
decode_step_time =
  (active_weight_bytes + batch_kv_bytes) / (hbm_bandwidth * MBU)
```

The active weights are read once for the batch, while each sequence contributes KV traffic.

## Cache Movement

Cache movement is modeled as bandwidth-bound:

```text
cache_load_time = kv_bytes / tier_bandwidth
```

Different tiers use different bandwidths:

- HBM is effectively local
- host RAM uses PCIe bandwidth
- peer cache uses RDMA bandwidth
- disk uses local disk bandwidth

## GPU Cluster

Each node is a group of GPUs serving together with tensor parallelism. Compute, HBM bandwidth, HBM capacity, RAM bandwidth, RDMA bandwidth, and disk bandwidth are aggregated across the GPUs in the node.

Nodes are independent serving replicas. Each node must fit the model in its combined HBM.

## Queueing And Batching

Each node has a queue. Requests wait until they can be admitted. Decode runs as a continuous batch up to `MAX_BATCH`.

Prefill pauses decode in the current model, which approximates prefill-prioritizing schedulers and makes prefill/queue interactions visible.

# Try it now

Please try it out and share your feedback with us. We would also love extensions to the open-source repository.

Live demo: [inference-sim.vercel.app](https://inference-sim.vercel.app/)

GitHub: [jwlaboratory/inference-sim](https://github.com/jwlaboratory/inference-sim)

Quickstart:

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python server.py
```

Open:

```text
http://localhost:8000
```

Or run the CLI:

```bash
python3 simulate.py
```

*/ }),
  },
  {
    slug: "biting-the-bullet",
    title: "Biting the Bullet: Predictive Speculative KV Replication for Bursty LLM Inference",
    date: "2026-07-22",
    category: "Research",
    summary: "Predictive KV warming for bursty LLM inference workloads, using Infer-Sim to test when proactively replicating shared prefix cache can cut TTFT versus cache-aware routing.",
    markdown: markdown(() => { /*

# Biting the Bullet: Predictive Speculative KV Replication for Bursty LLM Inference

By: Shrey Birmiwal and Anish Bhat

GitHub: [jwlaboratory/bite-the-bullet](https://github.com/jwlaboratory/bite-the-bullet)

TLDR: When serving inference to production users, you often see sudden spikes of requests with the same long prefix (data labeling jobs, fanning out subagents, etc). We argue that public traces don't capture this pattern, and current GPU routing algorithms leave gaps under this environment. We share Biting the Bullet (BTB), which predicts large bursts and proactively replicates prefix cache from RDMA into GPU HBM before the burst lands. BTB cuts mean time to first token by 10-60% versus SGLang's default cache-aware router, and reduces p95 time to first token by up to 80-82% in the best cases.

# Background

When an inference server receives an LLM request, it first hits a router such as SGLang Model Gateway or Dynamo, which decides which cluster to send its request to based on a routing policy. Then it hits a queue in that particular cluster, which may be one GPU or a tensor-parallel group of GPUs serving the same copy of one model.

![Router layer sending requests to GPU clusters](/content/biting-the-bullet/router-overview.png)

You next need to understand KV cache management. In LLM generation, every request is a sequence of words. As long as two requests have the exact same prefix, they can reuse a lot of the computed math (the KV). It is important to note that the prefix must match exactly, so even a single token difference near the start of a request will break the KV cache.

![Two requests can share KV only when their prefix matches exactly](/content/biting-the-bullet/prefix-cache.png)

This shared prefix is called the prefix KV cache. For Llama-3.3-70B, it is about 320 KiB per token, so even a 1,000-token cached prefix is roughly 320 MiB of KV. Typically, the system prompt and initial definitions are cached and heavily reused across many users.

This prefix KV can be stored in a few different places. First, it can be stored in GPU HBM, which is the fastest to access. It can also be stored in host RAM, which is the CPU RAM connected to multiple GPUs. Finally, it can be stored on disk or NVMe, which is the slowest tier and may be shared across multiple clusters. RDMA is a special data-transfer method that allows one node's GPU to access and directly read from another GPU's HBM, bypassing CPU and OS overhead, which makes it very fast. This is what BTB uses to quickly preload another GPU with the cache it needs.

![Memory tiers and transfer paths for shared KV](/content/biting-the-bullet/memory-tiers.png)

| Tier | Per-GPU (datasheet) | Per-node (x4) | Role |
| --- | --- | --- | --- |
| HBM | 3.35 TB/s | 13.4 TB/s | local GPU memory (bandwidth floor / local hit) |
| RAM (PCIe) | 55 GB/s | 220 GB/s | KV offloaded to host DRAM |
| RDMA | 50 GB/s (400G NIC) | 200 GB/s | a peer node's KV over the fabric |
| Disk / NVMe | 7 GB/s | 7 GB/s (shared) | local SSD prefix cache |
| Prefill | 989 TFLOP/s peak | 1.98 PFLOP/s eff (MFU 0.5) | recompute |

The cost of regenerating the KV depends on the length of the prefix that was matched. The longer the prefix, the bigger the cost of generating compared to replicating or moving from an already existing source like RAM. The table below reports milliseconds to make the matched prefix KV available for one request at each prefix length, on the standard setup: one node = 4xH100 tensor-parallel, serving Llama-3.3-70B fp16 (KV ~320 KiB/token, MFU 0.5).

| Source | 500 tok (ms) | 1k tok (ms) | 2k tok (ms) | 8k tok (ms) | 16k tok (ms) | 32k tok (ms) | vs. prefill |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Prefill (recompute) | 35.7 | 71.4 | 142.8 | 571 | 1142 | 2284 | 1x |
| Disk / NVMe | 23.4 | 46.8 | 93.6 | 374 | 749 | 1498 | 1.5x faster |
| RDMA (remote GPU) | 0.82 | 1.64 | 3.28 | 13.1 | 26.2 | 52.4 | 44x faster |
| RAM (host, PCIe) | 0.75 | 1.49 | 2.98 | 11.9 | 23.8 | 47.7 | 48x faster |
| HBM (local floor) | 0.012 | 0.024 | 0.049 | 0.20 | 0.39 | 0.78 | 2919x faster |

![8k token prefix has the highest cost with prefilling, then disk, then RDMA, then RAM, then HBM](/content/biting-the-bullet/prefill-transfer-chart.png)

Clearly, prefill is much more expensive than keeping KV cache ready. This gives us the motivation: if we can see a burst incoming, it would be much faster to prewarm it with already computed KV.

# Large, Batched Requests Break Routers

There are a few routing policies that routers such as Dynamo and SGLang Model Gateway provide out of the box, the most popular by far being cache-aware routing. Each has tradeoffs that show up under bursty workloads.

## Least Load

The router selects the GPU with the lowest load (lowest incoming flight of requests). This is great when requests are unrelated, because it spreads work evenly. It is bad for same-prefix bursts, because it scatters the burst across cold replicas. Each cold replica then recomputes the same long prefix from scratch.

The best case is when many unrelated requests get evenly spread out, preventing any node hot spots.

![Least-load, best case: unrelated requests spread across replicas, so queues stay balanced](/content/biting-the-bullet/least-load-best.mp4)

The worst case is when a burst of same-prefix requests gets scattered across cold nodes, so none hit cached KV and each node has to do a full prefill.

![Least-load, worst case: the same-prefix burst scatters across cold replicas, so each replica recomputes the prefix](/content/biting-the-bullet/least-load-worst.mp4)

## Cache Aware

Cache-aware routing sends a request to the replica with the best prefix-cache match, then falls back to load balancing when the cluster is too imbalanced.

The best case is a steady trickle of similar-prefix requests, similar to many agentic chats, because each request keeps reusing the KV left warm by the previous request.

![Cache-aware, best case: similar-prefix requests reuse the warm KV cache without building a large queue](/content/biting-the-bullet/cache-aware-best.mp4)

The worst case is a burst of same-prefix requests. Cache affinity pulls the whole burst toward the replica with the KV warm, which keeps a high cache hit rate but grows the queue size.

![Cache-aware, worst case: the burst piles onto the warm replica and a queue builds up while other replicas sit idle](/content/biting-the-bullet/cache-aware-worst.mp4)

In both routers, you can see how a burst of same-prefix requests causes issues that hurt the end-user experience. In least-load routing, you are not utilizing the KV you already created. In cache-aware routing, bursts cause you to build up a huge queue.

# Dataset Creation and Workload Pattern

When reading other papers that built routing algorithms or KV cache management algorithms, we found they often used Mooncake traces to backtest their theories. However, when we checked these datasets, we found that they were missing key pieces for this workload.

| Trace | Rows read | Arrival timestamps | Prefix hash / content | Max burst fanout (>=16 KV blocks in <=10s) |
| --- | --- | --- | --- | --- |
| ART-Chat-2.5M | 300,000 | yes | yes | 25 |
| Mooncake (conv / tool-agent / arxiv) | 12k-24k | yes | yes | 2 |
| BurstGPT | 300,000 | yes | no | - |
| LMSYS-Chat-1M | 1M convs | no | yes | - |
| ShareGPT | ~90k convs | no | yes | - |

After going through them, we found two different problems. Some datasets did not contain arrival timestamps, so they could not fully recreate a burst scenario. Others had timestamps, but did not include prefix hashes or content, so we could not tell whether the requests were actually sharing the same KV. Of the datasets that contained both, the pattern barely showed up: Mooncake only reached a 2-request deep-prefix fanout, and ART-Chat reached 25.

We hypothesize this happens because public traces are often made from toy/demo traffic, chat tools, or internal employee coding/chat workloads. These traces are useful, but they do not fully cover real enterprise LLM workloads like data labeling, parsing PDFs, batch extraction, or sub-agent fanout, where many requests can share the same long prompt or document. That is what motivated us to create our own dataset, [Bursted-ART](https://huggingface.co/datasets/shreybirmiwal/Bursted-ART). You can read more about how we created it in the appendix.

# Biting the Bullet

What if, instead of waiting for a queue to build up before splitting across GPUs, or instead of blindly distributing requests across multiple GPUs without warmed KV cache, we could predict as soon as we saw a stream of requests coming in that a burst was incoming, then automatically share the prefix using RDMA?

We tested this in [Infer-Sim](/post/infer-sim), our open-source simulator for routing algorithms and cache policies for inference workloads. The implementation is intentionally simple and lives in [2-bite-the-bullet/bite_the_bullet.py](https://github.com/jwlaboratory/bite-the-bullet/blob/main/2-bite-the-bullet/bite_the_bullet.py).

## The Detection System

The prototype has four constants:

| Constant | Meaning | Value |
| --- | --- | --- |
| X | same-prefix arrivals needed to fire | 2 |
| Y | shared-prefix length matched and copied | 256 blocks |
| Z | detection window | 1s |
| M | replicas to warm | 4 |

The algorithm works like this: if the same Y-block-length prefix arrives X times within Z seconds, BTB marks that prefix as active and warms M replicas by using RDMA to send the KV to other GPUs. Later requests with the same prefix can then route to the least-loaded warm replica instead of all queueing on one cache-owning node or spreading blindly to cold nodes.

If the prefix is too short, the burst count has not fired, or no resident copy exists yet, BTB falls back to the normal cache-aware router. The animation below shows how BTB gets triggered and warms other GPUs as a burst comes in.

![Biting the Bullet: the router detects the repeated prefix, warms peer replicas over RDMA, then spreads later burst requests across warm queues](/content/biting-the-bullet/biting-the-bullet.mp4)

The best-case scenario is a sustained same-prefix burst where the first few requests reveal the pattern and the rest of the burst arrives after RDMA copies have finished. In that case, BTB keeps the cache-hit benefit of cache-aware routing, but gives the burst multiple warm queues instead of one hot queue.

The worst-case scenario is a burst that is too short, arrives too quickly, or starts from a brand-new prefix. If the model is extremely compute-heavy, or if the burst ends before copies finish, warming helps less because the latency is dominated by compute or queueing that KV movement cannot remove, or because there are not enough later requests left to amortize the RDMA copy.

The results were extremely positive on the Bursted-ART dataset:

Note: these are simulated results from Infer-Sim using the Bursted-ART workload, not live production traffic.

| setup | CA mean | CA p95 | BTB mean | BTB p95 | mean speedup | p95 speedup |
| --- | --- | --- | --- | --- | --- | --- |
| 70b_h100x4 | 1.373s | 4.697s | 0.632s | 4.697s | +54.0% | +0.0% |
| qwen3_8b_h100x4 | 0.034s | 0.325s | 0.023s | 0.059s | +33.3% | +81.8% |
| glm45_h100x4 | 0.288s | 1.905s | 0.115s | 0.780s | +60.0% | +59.0% |
| glm52_h100x8 | 0.134s | 1.101s | 0.062s | 0.243s | +53.5% | +78.0% |
| kimi_k2_h100x8 | 0.093s | 0.832s | 0.048s | 0.167s | +48.1% | +79.9% |
| dense1t_b300x4 | 436.8s | 926.1s | 392.0s | 857.9s | +10.3% | +7.4% |

The result speedup is shown below:

![Mean TTFT for cache-aware routing versus early RDMA warming](/content/biting-the-bullet/results.png)

# Related Work

BTB is an project at the intersection of predictive resource managemment and cache-aware routing.

On the predictive side, [PreServe](https://arxiv.org/abs/2504.03702) proposes a load anticipator that forecasts incoming request load and maintains a KV cache memory usage projection map to guide proactive scaling. Although similar to BTB, this operates at cluster scale over longer timescales rather than per-burst replication over seconds. [Cachewise](https://arxiv.org/abs/2606.16824) predicts KV block reuse times for coding agents from the tool-call metadata and then evicts less aggressively when reuse is more likely. [Learned Prefix Caching](https://openreview.net/pdf?id=Vj48eXaQDM) trains a small model on prompt content to predict whether a conversation will continue and uses that to decide what to evict. These papers show that predictive signals help, but they do not address the same prefix burst case with RDMA replication.

On the routing side, [Preble](https://arxiv.org/abs/2407.00023) and [Mooncake](https://arxiv.org/abs/2407.00079) discuss prefix cache reuse across many nodes, but they respond to load imbalance after it happened by moving KV around. The idea of duplicating work to cut tail latency goes back to [Jeff Dean and Luiz Barroso's "The Tail at Scale"](https://research.google/pubs/the-tail-at-scale/). BTB is the specialization of that idea for KV replication over RDMA triggered on burst detection.

# Future Work

1. We used [Infer-Sim](/post/infer-sim) and the [Bursted-ART](https://huggingface.co/datasets/shreybirmiwal/Bursted-ART) dataset, which includes synthetic bursts. This was great for testing the mechanism, but the next step is to test BTB in a production serving stack with real inference requests, real queues, real scheduler behavior, and real cache pressure.
2. Speculative prefill. The idea here is to predict the burst before any requests actually arrive, then spend idle compute to start prefilling the shared prefix on extra replicas. Unlike RDMA warming, this does not require KV to already exist somewhere. This can be better because it could spin up new KV earlier, but it can also be worse because false positives spend real compute. One version we tested was partial fake prefill: instead of prefilling the entire shared prefix, prefill a certain percentage of it or prefill in chunks.
3. More cache actions beyond replicate, such as pin, evict, demote, and promote.
4. Make detection thresholds adaptive to burst size, queue load, and cache pressure.
5. Use the actual user query as a hint for when bursts are coming. For example, the router could look at whether the request includes a system prompt that looks like a data labeling job, a batch extraction job, or another prompt that is likely to be reused many times.

# Appendix: Reproducing Bursted-ART

Bursted-ART starts with the original [ART-Chat-2.5M](https://huggingface.co/datasets/alessiotoniolo/ART-Chat-2.5M) replay windows, keeps normal ART traffic intact, and adds synthetic windows with synchronized long-prefix bursts. Each synthetic window models a data labeling job, batch scoring job, or sub-agent fanout: many requests arrive over the same 60-second window and share a 65,536-token prefix, while each request keeps its own suffix. We also add decoy jobs so the detector does not fire on any repeated prefix; it needs sustained reuse with enough future traffic to make warming worth it.

The generated rows preserve the request-level fields Infer-Sim needs for replay: arrival time, input length, output length, prefix block hashes, request/session/group IDs, source, trace ID, and metadata. The current split is 10 train windows and 30 test windows, or 25,600 train rows and 76,800 test rows.

The dataset construction code lives in the BTB repo. The important files are:

- Dataset generator: [3-workload/generate/generate_combined_dataset.py](https://github.com/jwlaboratory/bite-the-bullet/blob/main/3-workload/generate/generate_combined_dataset.py)
- Dataset upload helper: [3-workload/generate/upload_to_hf.py](https://github.com/jwlaboratory/bite-the-bullet/blob/main/3-workload/generate/upload_to_hf.py)
- Public dataset: [shreybirmiwal/Bursted-ART](https://huggingface.co/datasets/shreybirmiwal/Bursted-ART)
- Original ART dataset: [alessiotoniolo/ART-Chat-2.5M](https://huggingface.co/datasets/alessiotoniolo/ART-Chat-2.5M)
- Simulator replay loader: [inference-sim/workload.py](https://github.com/jwlaboratory/inference-sim/blob/main/workload.py)

To regenerate the dataset locally from the BTB repo:

```bash
python3 3-workload/generate/generate_combined_dataset.py \
  --synthetic-burst-window-s 60 \
  --out-dir 3-workload/generate/out/Bursted-ART
```

*/ }),
  },
  {
    slug: "sparklingtree",
    title: "SparklingTree: 30-40% faster speculative decoding over DSpark",
    date: "2026-08-05",
    category: "Research",
    authors: "Shrey Birmiwal",
    summary: "By combining first-order markov correction (DSpark), DDTree (tree based block diffusion draft speculative decoding), and a best-first search approximation, we create a speculator called SparklingTree. SparklingTree has a +32.7% increase in acceptance at budget 64 (+31.2% wall clock speedup), and +47.4% acceptance at budget 256 (+43.9% wall clock) over DSpark.",
    markdown: markdown(() => { /*
# SparklingTree: 30-40% faster speculative decoding over DSpark

TLDR: By combining first-order markov correction (DSpark), DDTree (tree based block diffusion draft speculative decoding), and a best-first search approximation, we create a speculator called SparklingTree. SparklingTree has a +32.7% increase in acceptance at budget 64 (+31.2% wall clock speedup), and +47.4% acceptance at budget 256 (+43.9% wall clock) over DSpark.

![SparklingTree (right) races against DSpark and other speculators, decoding faster.](/content/sparklingtree/race_4way.gif)

GitHub: [jwlaboratory/sparkling-tree](https://github.com/jwlaboratory/sparkling-tree)

# Understanding DFlash

Speculative decoding is a method in which a draft (tiny) language model drafts multiple tokens at once, so that a target (large) model can verify multiple tokens at once (parallel) instead of one at a time. For more information, you should read this article: [Speculative decoding from first principles](https://jwlabs.vercel.app/post/speculative-decoding-first-principles).

Traditionally, speculative decoding has been done using autoregressive language models (step by step generation, like ChatGPT or Claude). Over time, advancements from MTP to Medusa to Eagle led to higher and higher acceptance lengths. To increase the max amount of drafted tokens, we would increase the amount of work by a linear factor, since the model is autoregressive. *Actually, it'd be even more than linear, since attention is an $O(n^2)$ operation that grows as the number of tokens increases.*

![As sequence length increases, the wall clock time increases (super) linearly.](/content/sparklingtree/fig-ar-latency.png)

Suddenly, the "free drafter" does not look like a free drafter, even though acceptance lengths are high. This motivates DFlash.

DFlash uses a block level diffusion draft model, instead of an autoregressive language model. This means that instead of creating one token at a time, DFlash "denoises" an entire block in parallel. (For diffusion models, increasing the number of tokens generated does not increase the latency, while it may reduce quality of the drafter.)

![Diffusion models denoise in parallel, so increasing sequence length does not increase diffusion decoding time.](/content/sparklingtree/fig-diffusion-latency.png)

While the quality of the entire DFlash is lower (lower acceptance rate), it can draft 15 tokens instead of traditional drafters, i.e. Eagle3 (drafting just 3 at a time).

![Even though DFlash has a lower per-token acceptance rate, it has more net accepted tokens because of the increased drafting depth.](/content/sparklingtree/fig-eagle-vs-dflash.png)

DFlash creates a matrix of marginal probabilities that is sampled from and used as the drafted token for the target. We'll see how this is important in the next section. You can visualize this as a table with `Vocab` columns and `draft block size` rows.

$$
\begin{aligned}
p_{\mathrm{AR}}(u_{1:k} \mid c)
&= \prod_{i=1}^{k} p(u_i \mid c, u_{<i}) \\
q_{\mathrm{diff}}(u_{1:k} \mid c, b)
&= \prod_{i=1}^{k} q_i(u_i \mid c, b) \\
\end{aligned}
$$

DFlash brings huge speedups, however we'll discuss more of the limitations of DFlash in the following 2 sections.

DFlash Paper: [arxiv.org/pdf/2602.06036](https://arxiv.org/pdf/2602.06036)

# Understanding DDTree

Earlier, I explained that DFlash outputs a table with `Vocab` columns and `draft block size` rows. Each row is completely independent of each other (this is called *marginal* in statistics).

![DFlash outputs the per-position token distribution probabilities over the entire vocab.](/content/sparklingtree/fig-dflash-marginals.png)

The key insight of the DDTree paper is that we can use these independent marginals to construct not just a single path or single solution, but a tree of solutions. Whenever the confidence of the drafter is low, we can branch into 2 paths and we will capture a higher success probability. While the paths are more shallow, it will have a higher overall acceptance rate.

For each node $u$ in the draft tree $T$, let $X_u \in \lbrace 0, 1 \rbrace$ indicate whether $u$ is accepted. A node is accepted only if every token on the chain from the root down to $u$ is accepted, so the number of accepted tokens is $\sum_{u \in T} X_u$. By [linearity of expectation](https://brilliant.org/wiki/linearity-of-expectation/) (which holds even when the $X_u$ are dependent):

$$
\begin{aligned}
\mathbb{E}\left[\text{accepted} \mid T\right]
&= \mathbb{E}\left[\sum_{u \in T} X_u\right] \\
&= \sum_{u \in T} \Pr[u \text{ accepted}] \\
&= \sum_{u \in T} \prod_{v \in \mathrm{path}(u)} q(v)
\end{aligned}
$$

where $\mathrm{path}(u)$ is the chain from the root to $u$ (inclusive), and $q(v)$ is the per-token acceptance probability, so the product is the prefix probability that the entire chain up to $u$ survives verification.

Let's compare two different ways of doing this: chain vs tree.

![The chain with the same budget goes deeper but has lower expected value than the tree.](/content/sparklingtree/fig-chain-vs-tree.png)

Here you can see the sum of the chain has an expected value of:

$$
\begin{aligned}
\mathbb{E}\big[\text{accepted} \mid \text{chain}\big]
&= \sum_{d=1}^{4} \prod_{i=1}^{d} q_i \\
&= 0.55 + 0.44 + 0.31 + 0.26 \\
&= 1.56
\end{aligned}
$$

However the sum of the tree has an expected value of:

$$
\begin{aligned}
\mathbb{E}\big[\text{accepted} \mid \text{tree}\big]
&= \sum_{u \in T} \prod_{v \in \mathrm{path}(u)} q(v) \\
&= 0.55 + 0.40 + 0.44 + 0.34 \\
&= \mathbf{1.73}
\end{aligned}
$$

Clearly, the tree even though being much shallower has a higher expected value (even at the same total token budget). The cost of the tree is the cost of creating and verifying more tokens. DDTree mitigates much of this in the way it creates the tree and its tree attention mask, but at higher batch sizes the cost definitely weighs down on performance.

### How is the tree actually created?

DDTree implements the tree creation and verification using a lazy best-first heap algorithm. It's important to understand how it works because in SparklingTree we have to modify this algorithm.

A max heap is a data structure that uses a tree. The heap keeps the max element at the top, and at each layer lower, strictly smaller items. You can push any element, and the heap will add it at $O(\log N)$ time. You can also take the top element out in $O(\log N)$ time as well because of the nature of tree operations. You can read about how max heaps work here: [introduction to max heap](https://www.geeksforgeeks.org/dsa/introduction-to-max-heap-data-structure/).

#### Step 1: Sorting the DFlash marginals

The matrix shape is 15 rows (token guess at position 1, 2, … block size = 15) by vocab size (approx 152k columns). On GPU (`torch.topk`), it selects the top K logits of each row (K being the max token budget for the tree, because we can never take something outside the max token budget anyway), and then runs `torch.logsumexp` to make each logit comparable, then finally sorts each row.

![The GPU sorts the top-k logits and creates a map in one pass.](/content/sparklingtree/fig-gpu-topk-sort.png)

Since it's relatively small and on GPU, it doesn't take much time to do this compute. It creates 2 vectors: `top_logits` (the values), and `top_token_ids` (indices into vocab). We needed to sort so the following sequential steps are much faster.

The code from the official DDTree codebase ([github.com/liranringel/ddtree](https://github.com/liranringel/ddtree)) that does this sorting on GPU:

```python
topk = min(budget, draft_logits.shape[-1])   # how many to sample (top-K) per row
depth_limit = int(draft_logits.shape[0])      # horizontal length; cannot go deeper than this
logits = draft_logits.float()
top_logits, top_token_ids = torch.topk(logits, k=topk, dim=-1)
log_z = torch.logsumexp(logits, dim=-1, keepdim=True)
```

#### Step 2: Copy this over to the CPU

Next, the GPU sends these values to the CPU. Since the actual tree generation involves building a heap (sequential) and lookup tables, it's much better suited for the CPU rather than the device/GPU.

The cost of this is that we need to do a device to host synchronization, causing blockades and transfer costs between CPU and GPU. This is clearly bad, but the DDTree authors outweigh this synchronization with the benefits of the tree. To learn more about this, read this article by [@charles_irl](https://x.com/charles_irl): [host overhead and inference efficiency](https://modal.com/blog/host-overhead-inference-efficiency).

![The copy over from device to host.](/content/sparklingtree/fig-device-to-host.png)

```python
top_log_probs_cpu = (top_logits - log_z).to(device="cpu", dtype=torch.float32)
top_token_ids_cpu = top_token_ids.to(device="cpu", dtype=torch.long)
build_subtimes["tree_build_copy"] = cuda_time() - copy_start
```

#### Step 3: The best-first heap algorithm

The algorithm will pop the top element in the heap (highest probability cumulative path) so far. Then, add the next highest probability sibling (explore horizontally), and the highest probability child (explore deeper), back into the heap.

![At each pop, the algorithm takes the next best sibling and the best child, guaranteeing it covers all possible routes incorporating the highest probability paths.](/content/sparklingtree/fig-heap-expansion.png)

It does this sequentially until it has popped enough elements to reach the node budget. The algorithm guarantees you will capture the highest total expected value. You can read more about the algorithm here: [best-first search](https://www.geeksforgeeks.org/dsa/best-first-search-informed-search/).

```python
while heap and node_count < budget:
    _, ranks, parent_index, depth, rank, logw = heapq.heappop(heap)

    token_id = int(top_token_ids_np[depth - 1, rank])
    current_index = node_count + 1
    node_token_ids_np[node_count] = token_id
    node_depths_np[node_count] = depth
    parents_np[current_index] = parent_index
    child_maps.append(dict())
    child_maps[parent_index][token_id] = current_index
    node_count += 1

    if rank + 1 < topk:
        sibling_ranks = ranks[:-1] + (rank + 1,)
        sibling_logw = logw - float(top_log_probs_np[depth - 1, rank]) + float(top_log_probs_np[depth - 1, rank + 1])
        heapq.heappush(heap, (-sibling_logw, sibling_ranks, parent_index, depth, rank + 1, sibling_logw))

    if depth < depth_limit:
        child_ranks = ranks + (0,)
        child_logw = logw + float(top_log_probs_np[depth, 0])
        heapq.heappush(heap, (-child_logw, child_ranks, current_index, depth + 1, 0, child_logw))
```

#### Step 4: Creating the tree mask

This part runs through the tree and creates a flattened indexed array that explains what the ancestor of each token is. This becomes useful during the speculative decoding verification step, because the GPU can do a single fat matrix multiplication instead of many small ones, because it knows exactly what tokens need to be computed relating to what other KV.

![The tree visibility mask flattens the tree to an ancestor mask that can be used for tree attention.](/content/sparklingtree/fig-tree-mask.png)

```python
visibility_np = np.zeros((current_length, current_length), dtype=np.bool_)
visibility_np[0, 0] = True
for index in range(1, current_length):
    parent_index = int(parents_np[index])
    visibility_np[index, :index] = visibility_np[parent_index, :index]
    visibility_np[index, index] = True
build_subtimes["tree_build_visibility"] = time.perf_counter() - visibility_start
```

Overall DDTree provably has a higher expected number of accepted tokens (assuming that the drafter's "confidence" per vocab is the expected probability of it being accepted), even at the same token budget. However, it comes at a cost: the creation of such a tree, the tree mask, CPU host sync overhead, and the weird matmul (jumping around a lot with the tree mask as opposed to a standard attention). DDTree generally is really good for extremely memory bound systems (low batch sizes), but starts to lose due to the overhead at higher batch sizes.

DDTree Paper: [arxiv.org/pdf/2604.12989](https://arxiv.org/pdf/2604.12989)

# Understanding DSpark

DSpark brings 2 new contributions to DFlash: first a confidence aware, hardware aware dynamic verification length, and second an autoregressive markov model head to align the marginals of DFlash. I'll quickly explain the former and focus on the latter because it is what we use in SparklingTree.

## Confidence aware, hardware aware dynamic verification

DFlash always drafts the same amount of tokens but also verifies all of the tokens. This assumes that verification is parallel and free (which it somewhat is). However, at large batch sizes, when balancing compute bound and memory bound, having an infinite amount of tokens to verify eventually comes at compute costs and is no longer free.

To ride the compute bound / memory bound line even closer, DSpark adds 2 components to make the verification dynamic. First, a confidence head that uses the hidden state and previous token embedding and squashes it to a probability. They also add a calibration step to normalize against overconfident neural scores. Second, it profiles the hardware ahead of time into a throughput curve to figure out what the optimal amount of verification tokens is.

I didn't dig deep into this contribution from DSpark, so please correct me if I am wrong. SparklingTree doesn't build on this part of DSpark, but I think future work could definitely exploit the confidence or dynamic verification contribution.

## First order markov model conditioning

The second contribution of DSpark is a small autoregressive head that helps align the diffusion drafter.

Let's see why this is useful, with a concrete (famous) example. Recall the DFlash output table from earlier: the two valid completions are "Of course" and "No problem", and the marginals at each position split their probability between them. This means that the sampling will sample "Of problem" or "No course" often. Because the DFlash model is a parallel diffusion model, each token is generated in parallel (with no knowledge of the previous token). Recall:

$$q(u_i \mid c, b)$$

The probability at token position $i$ depends on context and noise, but not the previous token.

Recall that we switched from an autoregressive model (Eagle3) to DFlash because DFlash was faster at larger context lengths, despite bringing such parallel issues. DSpark's contribution is an "in between ground," in which the drafter is a semi-autoregressive, semi-parallel drafter that is both fast at a large number of generated tokens, but also conditioned on previous tokens.

The solution is to first draft in parallel like DFlash. Then, run a lightweight first-order markov model autoregressively to push the token distributions to be dependent on each other.

![Each position is adjusted based on what was selected at position i−1 using the markov head.](/content/sparklingtree/fig-markov-conditioning.png)

A first-order markov model (like a bigram table) is represented as a $V \times V$ matrix, where $V$ is vocab size. It shows, given the first token in the vocabulary, what the probability is of the next token being vocab index $0 \ldots V$.

![The V×V matrix markov model showing the probability of a next token given a previous one.](/content/sparklingtree/fig-bigram-matrix.png)

Given the vocab size for large models is in the hundreds of thousands, this makes it quite expensive to load into memory. If you increase the vocab size, you increase the parameters by a factor of $O(V^2)$.

Instead, DSpark uses a **low rank factorization approximation**. The intuition is that words come in groups. For example, following the word "the" or "a" is likely a noun. You don't need to know that individually "cat" follows "the", but rather that a group "noun" follows a group of words that look like "the" or "a". This is represented as two multiplications: first the "extraction", which squeezes the vocab into scores for $R$ groups, then the "projection", which projects each group into the words it connects to. $R$ is the rank, with a default of 256 unique groups.

$$\underbrace{V \times V}_{\text{full bigram}} \;\gg\; \underbrace{V \times 256}_{\text{extraction}} + \underbrace{256 \times V}_{\text{projection}}$$

You can see clearly: if $V$ is 100,000, then $100\text{k} \times 100\text{k}$ is much larger than the sum of $V \times 256 + 256 \times V$.

Now, DSpark uses the output of DFlash, selects the top token at index 0, runs the markov corrector, samples the top token at index 1, runs the markov corrector, and repeats in a loop. The markov corrector biases the sampling to make coherent sentences, and the fast parallel diffusion drafter makes high quality choices quickly.

# Building SparklingTree

The DSpark paper shows an interesting insight. The chart below (taken from the DSpark paper) shows the per-position probability of acceptance. Note that this is not the cumulative probability, but the probability that position $i$ is accepted given that position $i-1$ was accepted.

![DFlash decreases in conditional acceptance over time, while Eagle3 increases due to autoregressiveness. DSpark is able to maintain a consistent acceptance rate by adding a tiny autoregressive head on top of DFlash.](/content/sparklingtree/dspark-per-position.png)

Here, especially in chat domains, we see that Eagle3 (autoregressive) is able to *increase* its acceptance probability over the positions. This is counterintuitive, but it's because if the autoregressive model finds its groove, it's likely to keep getting better over time. On the other hand, DFlash drops off a cliff over time, because the parallel diffusion model has the interference we discussed earlier. DSpark maintains a flat conditional acceptance by adding the lightweight autoregressive head.

At the same time, we saw that DDTree is able to bring much higher initial acceptance lengths to DFlash. This motivates us to try combining the parallel diffusion drafter to be fast (DFlash) + the autoregressive markov model to maintain acceptance at depth (DSpark) + trees to explore more branching nodes and get higher acceptance (DDTree). We call our idea "SparklingTree".

The rough outline for our initial naive SparklingTree is as follows:

1. Draft using the diffusion drafter.
2. Sort the first row (first index), push the top token onto the max heap.
3. Pop the max token from the heap, put it on the tree.
4. Run the autoregressive markov model on depth $i+1$ given depth $i$, sort the row, and push the top-probability child.
5. Push the top-probability sibling (already sorted and conditioned).
6. Repeat steps 3–5 until a full tree of max token budget is created.

We validated the idea by graphing the per-depth acceptance, now with SparklingTree included:

![The per-depth acceptance rate shows how DDTree starts high whilst DSpark is able to maintain more consistency compared to DFlash/DDTree. SparklingTree shows flat-ish + a high starting acceptance rate.](/content/sparklingtree/results-1.png)

Note: we use the [DDTree repository](https://github.com/liranringel/ddtree) and the greedy decoding technique from its benchmarking scripts.

DDTree starts at an extremely high acceptance rate, because it can hedge with multiple shallow branches early, rather than go down one path that might be wrong entirely, as we predicted. On the other hand, DSpark starts lower, but because it has an autoregressive biaser, it stays steady (on sequences in which it starts correct, it is likely to continue being correct), while DDTree dips hard.

SparklingTree takes the best of both worlds. It starts high due to the hedging and branching, but also maintains relatively steady throughout depth because of the markov model conditioning.

*Note: DDTree and DFlash are block size 16 drafters, so the graph continues for them, but not for this initial version of SparklingTree or DSpark.*

We next compare the acceptance lengths of the different models:

![SparklingTree improves on DSpark and DFlash but loses to DDTree (note the difference in block size).](/content/sparklingtree/results-2-acceptance-length.png)

Here it seems that DDTree beats SparklingTree, but look closer: DSpark-b7 and SparklingTree-block7 are block size 7 models, compared to the block 16 models for DDTree and DFlash. This means DFlash is drafting 15 tokens at once, while DSpark is drafting only 7 (and SparklingTree is almost hitting the max ceiling at 6.59). You'll also see that the markov model + tree applied to DSpark leads to a **+23.9%** gain.

## The harness must be trained jointly

You may wonder why we did not just use the DFlash model (since it is trained for block size 16) and drop it into the SparklingTree harness (DSpark markov model + tree). While the tree addition alone would work (DDTree works out of the box with DFlash, since it expects marginal probabilities), DSpark's markov model would *not* work.

The reason for this is that the markov model is trained **jointly** with the diffusion drafter. The objective of training DFlash is to make the top-probability tokens form a coherent sentence matching the target. The objective of training DFlash to work with the DSpark markov model is to train a model that generates probabilities that, *after being corrected*, create a coherent sentence.

To prove the point, we took the standard DFlash and added the markov model. We also took the DSpark model and took away the markov model. Clearly, the markov model only works when it was jointly trained.

![The model only earns its weight when paired with what it was jointly trained with: DSpark needs both the markov model and the DSpark base, and DFlash gets worse (−16%) with a foreign corrector.](/content/sparklingtree/results-3-joint-training.png)

This gives us our first insight: the harness needs to be trained jointly with the model, or else it's not usable. This also means that for us to properly compare DFlash/DDTree (block size 16) against DSpark/SparklingTree (block size 7, nearly saturated), we'll need to train our own version of DSpark that is jointly trained for block size 16.

## Extending the block size because SparklingTree saturated b=7

Like I explained earlier, the DSpark model + markov corrector + tree pushed DSpark to its max limit of 7 drafted tokens.

![The block 7 SparklingTree is literally hitting its ceiling: 58% of b7 rounds land at the cap (gsm8k alone: 95%), versus only 8% at the b16 cap.](/content/sparklingtree/results-4-b7-ceiling.png)

To break past this ceiling, we had to retrain DSpark to work with a block size of 15 (16 max tokens drafted and accepted). Since the starting model, DeepSeek's released `dspark_qwen3_4b_block7` drafter, can be changed to draft 16 blocks with just a setting tweak (it does not change any parameter shapes), it can do block=16 out of the box, it just performs terribly because it has never seen training data above block=7.

We take the DeepSpec codebase, load in our starting point, then continue training with block size 16 on sequence size 768, 32 anchors per sequence, at 600 steps with 2,400 PerfectBlend chat conversations. We chose this dataset so as to not confound by training on the exact data we would test with. We also make sure to continue training the markov head (though it should not matter, since the markov model is position invariant) and the confidence head.

![DSpark finetuned to block size 16 performs the best because it breaks the b=7 ceiling: SparklingTree b16 reaches 8.21 accepted tokens per verifier call, +52% over DFlash.](/content/sparklingtree/results-5-final-acceptance.png)

The results achieve our goal of smashing the 7 token max limit of DSpark. We also tested DSpark with our b16 but *without* the tree verification, to isolate that it wasn't just the extra training on PerfectBlend giving us the speedup, but rather the tree itself. The results show that at block size 16, the tree gives a 39% advantage, and at block size 7 a 24% advantage.

Our checkpoint: [huggingface.co/shreybirmiwal/Qwen3-4B-DSpark-b16](https://huggingface.co/shreybirmiwal/Qwen3-4B-DSpark-b16)

The training recipe: `experiment2-block16/training/` in the [sparkling-tree repo](https://github.com/jwlaboratory/sparkling-tree)

## Measuring the wall clock speedup

We ran the algorithm using the DDTree benchmarking script and were surprised to see terrible speeds for the SparklingTree algorithm.

![SparklingTree b16 performs terribly with extremely low decode TPS: 21 tokens/sec versus 191 for DDTree, 137 for DSpark, and 124 for DFlash (tree budget 64).](/content/sparklingtree/results-6-decode-speeds.png)

But why does it do so poorly? Clearly SparklingTree is accepting many more tokens. Investigating the time breakdown shows the story more completely:

![The breakdown of time spent across DFlash, DSpark, DDTree, and SparklingTree.](/content/sparklingtree/results-7-phase-shares.png)

|  | DFlash | DSpark | DDTree TB=64 | DDTree TB=256 | SparklingTree, B=16, Tree Budget = 64 | SparklingTree, B=16, Tree Budget = 256 |
| :---- | :---- | :---- | :---- | :---- | :---- | :---- |
| Draft forward pass | 1.24 ms/committed-tok · 16.6% · 5.58 ms/round | 1.20 ms/committed-tok · 16.5% · 5.64 ms/round | 0.82 ms/committed-tok · 16.5% · 5.29 ms/round | 0.76 ms/committed-tok · 16.3% · 5.45 ms/round | 0.86 ms/committed-tok · 1.8% · 6.13 ms/round | 0.74 ms/committed-tok · 0.7% · 5.93 ms/round |
| Candidate tree construction | 0.01 ms/committed-tok · 0.1% · 0.05 ms/round | 0.11 ms/committed-tok · 1.6% · 0.54 ms/round | 0.08 ms/committed-tok · 1.5% · 0.49 ms/round | 0.12 ms/committed-tok · 2.7% · 0.89 ms/round | 41.93 ms/committed-tok · 88.8% · 299.34 ms/round | 107.75 ms/committed-tok · 96.0% · 860.21 ms/round |
| Verification by target model over candidates | 6.13 ms/committed-tok · 81.8% · 27.59 ms/round | 5.85 ms/committed-tok · 80.5% · 27.55 ms/round | 3.82 ms/committed-tok · 76.7% · 24.60 ms/round | 3.52 ms/committed-tok · 75.5% · 25.25 ms/round | 4.09 ms/committed-tok · 8.7% · 29.23 ms/round | 3.45 ms/committed-tok · 3.1% · 27.57 ms/round |
| Everything else | 0.11 ms/committed-tok · 1.5% · 0.49 ms/round | 0.10 ms/committed-tok · 1.4% · 0.47 ms/round | 0.26 ms/committed-tok · 5.3% · 1.71 ms/round | 0.25 ms/committed-tok · 5.5% · 1.83 ms/round | 0.31 ms/committed-tok · 0.7% · 2.23 ms/round | 0.29 ms/committed-tok · 0.3% · 2.31 ms/round |
| Total | 7.50 ms/committed-tok · 33.72 ms/round | 7.26 ms/committed-tok · 34.20 ms/round | 4.98 ms/committed-tok · 32.09 ms/round | 4.66 ms/committed-tok · 33.42 ms/round | 47.20 ms/committed-tok · 336.94 ms/round | 112.23 ms/committed-tok · 896.01 ms/round |
| accept/round (committed tokens per verify round) | 4.50 | 4.71 | 6.45 | 7.17 | 7.14 | 7.98 |

**Observations**

1. **Draft forward pass:** The time per round is approximately the same. Draft forward is the time it takes for the diffusion draft model to do a forward pass, and it is approximately the same because they all share similar setups (4B-param diffusion drafters each doing one block forward per round). The time per committed token slightly varies (being fastest for SparklingTree) because it differs in accuracy (SparklingTree creates the most committed tokens).
2. **Candidate tree construction:** **The huge one. Let's get back to this one below.**
3. **Verification by target model over candidates:** Approximately the same. Of course the tree approaches have more nodes to verify, so it costs slightly more. Nuance 1: at larger batch sizes it is hard to say how this will change. I'm guessing it'll get worse once you pass the tip of the compute-bound ridge. At this point, being extremely memory bound (running batch size 1) under-shows the verification cost being the same (because all nodes are parallelized, and the bottleneck is the memory bandwidth loading in weights). Nuance 2: in MoE models it is hard to say how this will change as well. MoE models have to load in experts, so having more tree nodes to verify may trigger more experts to load in (which is bad, considering you are already memory bound).

### What the heck is happening with the candidate tree construction?

Let's recall how the tree was constructed under DFlash, DDTree, DSpark, and now SparklingTree.

1. **DFlash:** No tree at all. The diffusion drafter runs, then we take a singular GPU operation to get the top element at each index (argmax). The candidate construction is fastest (0.05 ms/round) because it is a singular GPU operation.

![DFlash runs the diffusion drafter and samples argmax on GPU.](/content/sparklingtree/fig-build-dflash.png)

2. **DDTree:** The diffusion drafter runs. We take a singular GPU operation to sort the top-k elements in each index (positions are independent, so this can be done upfront). One tiny table is copied over to the CPU, which iteratively builds a heap from this sorted table. The candidate construction is 0.49 ms/round, slower than DFlash due to the CPU working in a loop, but faster than the other speculators.

![DDTree takes top K once on GPU, then builds a heap quickly on CPU.](/content/sparklingtree/fig-build-ddtree.png)

3. **DSpark:** No tree at all. The diffusion drafter runs once. We then run the tiny autoregressive head on the GPU, bias the diffusion drafter, and sample the next token iteratively. DSpark is slightly slower (0.54 ms/round) than DDTree and DFlash because of the tiny autoregressive head: N small GPU operations have to occur rather than 1 big batched GPU operation.

![DSpark runs the autoregressive head on GPU and samples iteratively.](/content/sparklingtree/fig-build-dspark.png)

4. **SparklingTree:** First, we create the diffusion draft matrix one time. Because the positions are no longer independent (markov model), top-k can no longer be precomputed upfront on the GPU. We have to first copy over the entire matrix to the CPU, which runs the heap algorithm from DDTree in a loop, but with the top-k computation + markov model running EVERY pop, and on CPU. It is by far the slowest at 299.34 ms/round.

![SparklingTree has to run heap creation on CPU, with top-k and markov model generation on CPU.](/content/sparklingtree/fig-build-sparklingtree.png)

### Solving the candidate tree construction

Two key culprits are hitting us at the same time:

**1. Transfer cost between CPU and GPU (the "prep" time)**

We cannot go back and forth from CPU to GPU at each step. This means we can't just run the Markov model on the GPU and send results to the CPU to build the heap, because it'd take too much bandwidth (especially at batch sizes). So, we have to send all the compute to be done on the CPU. Additionally, we have to send the entire diffusion matrix (entire vocabulary size × block size) to the CPU.

The way we explore cutting this down is by running the top-k over all indexes immediately after the diffusion drafter is done (on GPU), before sending anything to the CPU. This could be lossy, because the markov bias is additive, so a token outside the base top-k could have been promoted into the true biased top-k that was excluded. It still captures ~99% because the bias is relatively small, so if we capture enough of a top-k (a few thousand instead of the 100k+ vocabulary size), we can practically cover it all.

We see a nearly 10× speedup by sending only the top-k of k=128 at node budget 64:

![A 9.73× speedup (25 to 241 tokens/sec) by transferring only the top 128 candidates to CPU instead of the full 311 MB vocab slice.](/content/sparklingtree/results-8-topk-transfer.png)

Surprisingly, BOTH the time to send the candidates to CPU (expected to decrease, because we send only a fraction of the full vocab size) AND the expansion time to create the heap (an unexpected side benefit) decreased significantly. The reason is that with a lower vocab size, the sorting and selecting task for the CPU becomes drastically faster as well.

![The prep time (sending over the candidates to CPU) AND the expansion (heap building) time collapse drastically.](/content/sparklingtree/results-9-prep-collapse.png)

**2. Doing repeated compute on CPU (particularly in the loop of expanding the tree)**

When we were working with DDTree, we could do the computation of top-k all as one batched matmul on the GPU beforehand, because of the independence between indexes. Now, we have to do N small sorts all on CPU. (Multiple small serial operations, and on CPU, is not good.)

We need a way to be able to precompute as much of the iterative work in a single batch beforehand. Since it's only a first order markov model, it only needs to look back one token to determine the delta for the next token. Because of this, we can basically precompute into a table the entire (not low rank 2 multiplies) top-k markov model table upfront on the GPU and calculate the deltas at each depth upfront. Then, the CPU can simply do reads (no need to run the markov model each time or update the deltas and resort).

![A 1.16× speedup (241 to 278 tokens/sec) by precomputing all the tree possibilities, with acceptance unchanged.](/content/sparklingtree/results-10-precompute-tps.png)

Even though we see a slight increase in the prep time (more compute upfront), the expansion (heap creation time) disappears almost entirely.

![Increase in candidate prep, sharp decrease in candidate expand.](/content/sparklingtree/results-11-precompute-breakdown.png)

When comparing our final engineering results with DDTree, we see we are extremely competitive (and still leave room on the table for more work, i.e. fused kernels, beam search):

| Candidate construction (ms/round, budget 64, sync-on) | DDTree | SparklingTree |
| :---- | :---- | :---- |
| GPU table + one transfer (".prep") | 0.26 | 1.21 |
| CPU heap walk (".expand") | 0.12 | 0.15 |
| visibility mask | 0.04 | 0.04 |
| total candidate_build | ~0.5 | ~1.4 |

# Conclusion and results

Using the DDTree paper benchmarking scripts (their setup of sync timing and their C++ KV compaction kernel enabled), we compare autoregressive, DFlash, DSpark, DDTree, and SparklingTree on six datasets spanning code (humaneval, mbpp), math (gsm8k, math500), and chat (mt-bench, alpaca), using a fresh random sample draw, 512-token generations, tree budgets {64, 128, 256}, greedy (temp 0) and sampling (temp 1.0), one H100, and all jobs on the same Modal GPU.

At node budget 64 and a top-k C=128, the results show SparklingTree at a 7.34 mean acceptance (+634% over autoregressive, +43.92% over DFlash, +32.73% over DSpark, +7.00% over DDTree), and a wall clock speedup of 4.29× (+329.62% over autoregressive, +36.31% over DFlash, +31.18% over DSpark, and +4.20% over DDTree).

![Final results at budget 64 (C=128, fanout 64, sync-on, one GPU, 6 datasets): SparklingTree leads at 4.29× speedup vs autoregressive and 7.34 mean acceptance.](/content/sparklingtree/results-12-final-budget64.png)

| budget 64 | mean acceptance | tok/s | speedup vs AR |
| :---- | ----: | ----: | ----: |
| Autoregressive | 1.00 | 52.0 | 1.00× |
| DFlash | 5.10 | 163.9 | 3.15× |
| DSpark | 5.53 | 170.3 | 3.27× |
| DDTree | 6.86 | 214.4 | 4.12× |
| SparklingTree | 7.34 | 223.4 | 4.29× |

At each domain, you can see SparklingTree generally edges out other methods, except for DDTree in hard domains such as math and coding:

![Per-domain decode throughput at budget 64: SparklingTree wins alpaca, gsm8k, humaneval, and mt-bench; DDTree wins math500 and mbpp.](/content/sparklingtree/results-13-per-domain.png)

Perhaps this may be due to our training of the markov model at block size 16 on PerfectBlend. Definitely room to improve the markov model and the overall base DSpark model for block size 16.

Overall, over DSpark, we show huge gains in both speedups and acceptance:

| method | acceptance (tok/round) | decode tok/s | speedup vs AR |
| :---- | ----: | ----: | ----: |
| DSpark (chain, markov) | 5.53 | 170.3 | 3.27× |
| **SparklingTree, budget 64** | **7.34 (+33%)** | **223.4 (+31%)** | **4.29×** |
| **SparklingTree, budget 128** | **7.73 (+40%)** | **238.3 (+40%)** | **4.58×** |
| **SparklingTree, budget 256** | **8.15 (+47%)** | **245 (+44%)** | **4.71×** |

## Future Ideas

1. We saw that training the markov model jointly with the drafter is absolutely essential, otherwise accuracy collapses. Could it be that the tree should also be jointly baked into the training of the markov model + drafter?
2. Similarly, DSpark has a confidence head. This was originally designed for a chain (NOT a tree), but can we still use it to help decide when to stop verification? This could make this project more viable at higher batch sizes. Additionally, how does it perform when it is jointly baked into the training as well? I did some cursory experiments in the [archive-1 folder](https://github.com/jwlaboratory/sparkling-tree/tree/main/archive-1-speedup-w-confidence-head-verification) but didn't spend enough time to tell if this is an interesting direction.
3. We run benchmarks at batch size 1 because the engineering lift to make this work on an engine like SGLang or vLLM would be too large. We should next try larger batch sizes. We guess that the gains likely diminish rapidly at larger batch sizes. Additionally: trying tensor-parallel GPUs, MoE models (more experts need to be loaded in, doing worse with the tree's extra nodes to verify), and bigger models.
4. [Beam search](https://en.wikipedia.org/wiki/Beam_search) uses a fixed branching budget and has been shown to work well, instead of a best-first heap. I briefly tried an experiment in [archive-2](https://github.com/jwlaboratory/sparkling-tree/tree/main/archive-2-finding_best-beam). The results are somewhat interesting in that you actually want evenly spread out branches instead of front-loaded or back-loaded. This is space for more exploration.

Thank you very much for reading this! I've definitely learned a lot, from statistics to how the internals of speculators actually work. I'm immensely proud of my work and thankful for the people who've helped me learn this and for you for reading! I would love any feedback / corrections / discussions!

PS, I've spent > $1k in [@modal](https://x.com/modal) credits to build this and I'm now all out!! I would be super super grateful if anyone at Modal (or anywhere else) would like to help sponsor more open source blogs 🙏👀
*/ }),
  },
];
