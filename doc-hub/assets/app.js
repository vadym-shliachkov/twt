const toggle = document.querySelector("[data-menu-toggle]");
const nav = document.querySelector("[data-nav]");
const themeToggle = document.querySelector("[data-theme-toggle]");
const themeLabel = document.querySelector("[data-theme-label]");

if (toggle && nav) {
  toggle.addEventListener("click", () => {
    const open = nav.classList.toggle("is-open");
    toggle.setAttribute("aria-expanded", String(open));
  });
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem("twt-theme", theme);
  } catch {}
  if (themeToggle) {
    themeToggle.setAttribute("aria-pressed", String(theme === "light"));
    themeToggle.setAttribute("aria-label", theme === "light" ? "Switch to dark theme" : "Switch to light theme");
  }
  if (themeLabel) themeLabel.textContent = theme === "light" ? "Light" : "Dark";
}

setTheme(document.documentElement.dataset.theme || "dark");

if (themeToggle) {
  themeToggle.addEventListener("click", () => {
    setTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light");
  });
}

const observer = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (entry.isIntersecting) {
      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
    }
  }
}, { threshold: 0.14 });

document.querySelectorAll(".reveal").forEach((node) => observer.observe(node));

document.addEventListener("pointermove", (event) => {
  const mark = document.querySelector(".hero-mark");
  if (!mark || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const x = (event.clientX / window.innerWidth - 0.5) * 12;
  const y = (event.clientY / window.innerHeight - 0.5) * 12;
  mark.style.transform = `translate3d(${x}px, ${y}px, 0)`;
});
