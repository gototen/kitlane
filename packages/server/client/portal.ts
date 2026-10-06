/* Portal client: small progressive enhancements only. */
document.addEventListener("submit", (e) => {
  const form = e.target as HTMLFormElement;
  const msg = form?.dataset?.confirm;
  if (msg && !window.confirm(msg)) e.preventDefault();
});
