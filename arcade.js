// Copilot Arcade - game registry and navigation
window.Arcade = (() => {
  "use strict";

  const games = [];
  let current = null;
  let isReady = false;

  // DOM refs (resolved on first action)
  let menuScreen, reversiScreen, genericScreen, genericMount, backBtn, gameGrid;

  function resolveDom() {
    if (menuScreen) return;
    menuScreen = document.getElementById("menu-screen");
    reversiScreen = document.getElementById("reversi-screen");
    genericScreen = document.getElementById("generic-screen");
    genericMount = document.getElementById("generic-mount");
    backBtn = document.getElementById("back-btn");
    gameGrid = document.getElementById("game-grid");
  }

  function register(game) {
    games.push(game);
    if (isReady) buildMenu();
  }

  function buildMenu() {
    resolveDom();
    gameGrid.innerHTML = "";
    // Sort by order field, then name
    const sorted = games.slice().sort((a, b) => {
      const ao = a.order == null ? 999 : a.order;
      const bo = b.order == null ? 999 : b.order;
      if (ao !== bo) return ao - bo;
      return a.name.localeCompare(b.name);
    });
    sorted.forEach(g => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "game-card";
      card.style.setProperty("--game-color", g.color || "#00f0ff");
      card.innerHTML = `
        <div class="card-icon">${g.icon || "🎮"}</div>
        <div class="card-name">${g.name}</div>
        ${g.tag ? `<div class="card-tag">${g.tag}</div>` : ""}
      `;
      card.addEventListener("click", () => launch(g));
      gameGrid.appendChild(card);
    });
  }

  function launch(g) {
    resolveDom();
    if (current && current.onHide) {
      try { current.onHide(); } catch (e) { console.error(e); }
    }
    menuScreen.classList.add("hidden");
    reversiScreen.classList.add("hidden");
    genericScreen.classList.add("hidden");

    if (g.screen === "reversi") {
      reversiScreen.classList.remove("hidden");
    } else {
      genericScreen.classList.remove("hidden");
      genericMount.innerHTML = "";
      try { g.init(genericMount); } catch (e) { console.error("init failed", e); }
    }
    current = g;
    backBtn.classList.remove("hidden");
    if (g.onShow) {
      try { g.onShow(); } catch (e) { console.error(e); }
    }
  }

  function showMenu() {
    resolveDom();
    if (current && current.onHide) {
      try { current.onHide(); } catch (e) { console.error(e); }
    }
    reversiScreen.classList.add("hidden");
    genericScreen.classList.add("hidden");
    menuScreen.classList.remove("hidden");
    backBtn.classList.add("hidden");
    current = null;
  }

  function ready() {
    resolveDom();
    backBtn.addEventListener("click", showMenu);
    // Reversi is a built-in cartridge
    register({
      id: "reversi",
      name: "Reversi",
      icon: "⚫⚪",
      color: "#4fc3f7",
      tag: "STRATEGY",
      order: 1,
      screen: "reversi"
    });
    isReady = true;
    buildMenu();
    showMenu();
  }

  // Utility for games: build an overlay inside their mount showing game-over etc.
  function overlay(mount, html) {
    const ov = document.createElement("div");
    ov.className = "mg-overlay";
    ov.innerHTML = html;
    const parent = mount.closest(".game-panel") || mount;
    parent.appendChild(ov);
    return ov;
  }

  return { register, ready, showMenu, overlay };
})();
