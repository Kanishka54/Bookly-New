(function () {
  function idempotencyKeyFor(bookId) {
    const storageKey = "bookly-request-" + bookId;
    let key = sessionStorage.getItem(storageKey);
    if (!key || key.length < 8) {
      key =
        (window.crypto && crypto.randomUUID && crypto.randomUUID()) ||
        "req-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10);
      sessionStorage.setItem(storageKey, key);
    }
    return key;
  }

  function showMessage(el, text, isError) {
    if (!el) {
      alert(text);
      return;
    }
    el.hidden = false;
    el.textContent = text;
    el.style.color = isError ? "#da0735" : "#21912c";
  }

  async function requestBook(bookId, button, messageEl) {
    if (!bookId) {
      return;
    }
    if (button) {
      button.disabled = true;
    }
    showMessage(messageEl, "Sending request…", false);
    try {
      const response = await fetch("/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKeyFor(bookId),
        },
        body: JSON.stringify({ bookIds: [bookId] }),
      });
      const result = await response.json().catch(function () {
        return {};
      });
      if (response.status === 401) {
        showMessage(messageEl, "Please log in before requesting this book.", true);
        return;
      }
      if (response.status === 409) {
        showMessage(
          messageEl,
          result.message || "This book is unavailable.",
          true
        );
        return;
      }
      if (!response.ok) {
        showMessage(
          messageEl,
          result.message || "Request failed. You can try again.",
          true
        );
        return;
      }
      showMessage(
        messageEl,
        result.message || "Book reserved. This is a request, not a paid purchase.",
        false
      );
    } catch (err) {
      showMessage(messageEl, "Network error. You can try again.", true);
    } finally {
      if (button) {
        button.disabled = false;
      }
    }
  }

  window.requestBook = requestBook;

  document.addEventListener("DOMContentLoaded", function () {
    var button = document.getElementById("buy-now-btn");
    if (!button) {
      return;
    }
    button.addEventListener("click", function () {
      requestBook(
        button.getAttribute("data-book-id"),
        button,
        document.getElementById("buy-now-message")
      );
    });
  });
})();
