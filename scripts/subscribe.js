// Renders the email-list signup form into every [data-subscribe-root]
// element and posts submissions to /api/subscribe.
(function () {
  var roots = document.querySelectorAll("[data-subscribe-root]");
  if (!roots.length) {
    return;
  }

  roots.forEach(function (root) {
    root.innerHTML = [
      '<p class="subscribe-copy">Get an email when we publish new research.</p>',
      '<form class="subscribe-form" novalidate>',
      '  <input class="subscribe-input" type="email" name="email" placeholder="you@example.com" autocomplete="email" required />',
      '  <input class="subscribe-hp" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" />',
      '  <button class="subscribe-button" type="submit">Subscribe</button>',
      "</form>",
      '<p class="subscribe-status" role="status" aria-live="polite"></p>',
    ].join("\n");

    var form = root.querySelector(".subscribe-form");
    var input = root.querySelector(".subscribe-input");
    var honeypot = root.querySelector(".subscribe-hp");
    var button = root.querySelector(".subscribe-button");
    var status = root.querySelector(".subscribe-status");

    form.addEventListener("submit", function (event) {
      event.preventDefault();

      var email = input.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        status.textContent = "Please enter a valid email address.";
        return;
      }

      button.disabled = true;
      status.textContent = "Subscribing…";

      fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email,
          website: honeypot.value,
          source: location.pathname,
        }),
      })
        .then(function (res) {
          return res
            .json()
            .catch(function () {
              return {};
            })
            .then(function (data) {
              if (res.ok && data.ok) {
                form.hidden = true;
                status.textContent = "Subscribed — thanks.";
              } else {
                status.textContent =
                  data.error || "Something went wrong, please try again.";
              }
            });
        })
        .catch(function () {
          status.textContent = "Something went wrong, please try again.";
        })
        .finally(function () {
          button.disabled = false;
        });
    });
  });
})();
