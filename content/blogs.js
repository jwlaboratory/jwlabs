const markdown = (template) =>
  template
    .toString()
    .replace(/^[\s\S]*?\/\*/, "")
    .replace(/\*\/[\s\S]*$/, "")
    .trim();

window.BLOG_POSTS = [
  {
    slug: "llm-rl-assembly-codegen",
    title: "Using Large Language Models and Reinforcement Learning to Beat -O3 Assembly Code Generation",
    date: "2026-04-24",
    category: "Research",
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
];
