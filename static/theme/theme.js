(function () {
  const CONFIG_URL = "/static/theme/theme.conf";
  const DEFAULT_STORAGE_KEY = "sirius_theme";
  const DEFAULT_CONFIG = {
    storageKey: DEFAULT_STORAGE_KEY,
    icons: {
      light: "/static/theme/icons/luntosun.svg",
      dark: "/static/theme/icons/suntolun.svg",
      lightStatic: "/static/theme/icons/luntosun-static.svg",
      darkStatic: "/static/theme/icons/suntolun-static.svg",
      lightAlt: "/static/theme/icons/luntosun2.svg",
      darkAlt: "/static/theme/icons/suntolun2.svg"
    },
    light: {
      bg: "#f7f8f8",
      surface: "#ffffff",
      "surface-soft": "#f4f4f4",
      "surface-muted": "#eef3f3",
      "surface-strong": "#d5dadd",
      border: "#e9ecef",
      "border-soft": "#f0f0f0",
      "border-strong": "#bdbdbd",
      text: "#333333",
      "text-soft": "#626366",
      "text-muted": "#939191",
      "text-faint": "#a3a3a3",
      accent: "#4cbdcf",
      "accent-strong": "#2f9fb0",
      "accent-soft": "#eff9fa",
      "accent-soft-strong": "#d6f0f3",
      "success-soft": "#eff9fa",
      "success-text": "#2f9fb0",
      "danger-soft": "#eff9fa",
      "danger-text": "#2f9fb0",
      "warning-soft": "#eff9fa",
      "warning-text": "#2f9fb0",
      overlay: "rgba(17, 24, 39, 0.34)",
      shadow: "0 18px 48px rgba(15, 23, 42, 0.08)"
    },
    dark: {
      bg: "#050606",
      surface: "#0d1113",
      "surface-soft": "#111619",
      "surface-muted": "#161d20",
      "surface-strong": "#1f292d",
      border: "#273034",
      "border-soft": "#1b2326",
      "border-strong": "#39474c",
      text: "#f7f9f9",
      "text-soft": "#d7ddde",
      "text-muted": "#aab3b5",
      "text-faint": "#7f8b8e",
      accent: "#b34230",
      "accent-strong": "#d65a43",
      "accent-soft": "#25110e",
      "accent-soft-strong": "#3a1812",
      "success-soft": "#25110e",
      "success-text": "#d65a43",
      "danger-soft": "#25110e",
      "danger-text": "#d65a43",
      "warning-soft": "#25110e",
      "warning-text": "#d65a43",
      overlay: "rgba(0, 0, 0, 0.78)",
      shadow: "0 24px 64px rgba(0, 0, 0, 0.5)"
    }
  };

  const state = {
    theme: document.documentElement.dataset.theme === "dark" ? "dark" : "light",
    config: DEFAULT_CONFIG
  };

  function appendCacheBuster(url) {
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}v=${Date.now()}`;
  }

  function getSystemTheme() {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }

  function readTheme(storageKey) {
    try {
      const storedTheme = localStorage.getItem(storageKey);
      if (storedTheme === "dark" || storedTheme === "light") {
        return storedTheme;
      }
      return getSystemTheme();
    } catch (error) {
      return document.documentElement.dataset.theme === "dark"
        ? "dark"
        : getSystemTheme();
    }
  }

  function persistTheme(theme, storageKey) {
    try {
      localStorage.setItem(storageKey, theme);
    } catch (error) {
      return;
    }
  }

  function parseConfig(text) {
    const raw = {};
    const lines = text.split(/\r?\n/);

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex === -1) {
        continue;
      }

      const key = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed.slice(separatorIndex + 1).trim();
      raw[key] = value;
    }

    function extractPalette(prefix, fallback) {
      const palette = { ...fallback };
      Object.keys(raw).forEach((key) => {
        if (key.startsWith(prefix)) {
          palette[key.slice(prefix.length)] = raw[key];
        }
      });
      return palette;
    }

    return {
      storageKey: raw["storage.key"] || DEFAULT_STORAGE_KEY,
      icons: {
        light: raw["icon.light.primary"] || DEFAULT_CONFIG.icons.light,
        dark: raw["icon.dark.primary"] || DEFAULT_CONFIG.icons.dark,
        lightStatic: raw["icon.light.static"] || DEFAULT_CONFIG.icons.lightStatic,
        darkStatic: raw["icon.dark.static"] || DEFAULT_CONFIG.icons.darkStatic,
        lightAlt: raw["icon.light.alt"] || DEFAULT_CONFIG.icons.lightAlt,
        darkAlt: raw["icon.dark.alt"] || DEFAULT_CONFIG.icons.darkAlt
      },
      light: extractPalette("light.", DEFAULT_CONFIG.light),
      dark: extractPalette("dark.", DEFAULT_CONFIG.dark)
    };
  }

  function applyPaletteVariables(config) {
    const root = document.documentElement;

    ["light", "dark"].forEach((mode) => {
      Object.entries(config[mode]).forEach(([token, value]) => {
        root.style.setProperty(`--${mode}-${token}`, value);
      });
    });
  }

  function updateToggleButtons(replayAnimation) {
    const nextTheme = state.theme === "dark" ? "light" : "dark";
    const animatedIcon = state.theme === "dark" ? state.config.icons.dark : state.config.icons.light;
    const staticIcon = state.theme === "dark" ? state.config.icons.darkStatic : state.config.icons.lightStatic;
    const currentTitle = nextTheme === "dark" ? "\u0412\u043a\u043b\u044e\u0447\u0438\u0442\u044c \u0442\u0435\u043c\u043d\u0443\u044e \u0442\u0435\u043c\u0443" : "\u0412\u043a\u043b\u044e\u0447\u0438\u0442\u044c \u0441\u0432\u0435\u0442\u043b\u0443\u044e \u0442\u0435\u043c\u0443";

    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
      button.setAttribute("aria-pressed", state.theme === "dark" ? "true" : "false");
      button.setAttribute("aria-label", currentTitle);
      button.setAttribute("title", currentTitle);
    });

    document.querySelectorAll("[data-theme-toggle-icon]").forEach((image) => {
      const nextSrc = replayAnimation ? appendCacheBuster(animatedIcon) : staticIcon;
      if (image.dataset.themeIconSrc !== nextSrc) {
        image.dataset.themeIconSrc = nextSrc;
        image.src = nextSrc;
      }
      image.alt = state.theme === "dark" ? "\u0422\u0435\u043c\u043d\u0430\u044f \u0442\u0435\u043c\u0430" : "\u0421\u0432\u0435\u0442\u043b\u0430\u044f \u0442\u0435\u043c\u0430";
    });
  }

  function setTheme(theme, options) {
    const settings = Object.assign({ persist: true, replayAnimation: false, dispatch: true }, options);
    const previousTheme = state.theme;
    state.theme = theme === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = state.theme;

    if (settings.persist) {
      persistTheme(state.theme, state.config.storageKey);
    }

    updateToggleButtons(settings.replayAnimation);
    if (settings.dispatch && previousTheme !== state.theme) {
      document.dispatchEvent(new CustomEvent("themechange", { detail: { theme: state.theme } }));
    }
  }

  function bindToggles() {
    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
      if (button.dataset.themeBound === "true") {
        return;
      }

      button.dataset.themeBound = "true";
      button.addEventListener("click", function () {
        const nextTheme = state.theme === "dark" ? "light" : "dark";
        setTheme(nextTheme, { persist: true, replayAnimation: true });
      });
    });
  }

  async function loadConfig() {
    try {
      const response = await fetch(CONFIG_URL, { cache: "no-store" });
      if (!response.ok) {
        return DEFAULT_CONFIG;
      }
      return parseConfig(await response.text());
    } catch (error) {
      return DEFAULT_CONFIG;
    }
  }

  async function initTheme() {
    state.config = await loadConfig();
    applyPaletteVariables(state.config);
    bindToggles();
    setTheme(readTheme(state.config.storageKey), {
      persist: false,
      replayAnimation: false,
      dispatch: false
    });
    requestAnimationFrame(function () {
      document.documentElement.classList.add("theme-ready");
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initTheme, { once: true });
  } else {
    initTheme();
  }
})();
