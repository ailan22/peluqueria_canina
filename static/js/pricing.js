(function () {
  var root = document.getElementById("price-calc");
  if (!root) return;

  var data;
  try {
    data = JSON.parse(root.getAttribute("data-precios") || "{}");
  } catch (e) {
    return;
  }

  var SIZE_LABELS = {
    mini: "Mini",
    pequeno: "Pequeño",
    mediano: "Mediano",
    grande: "Grande",
    gigante: "Gigante",
  };

  var SERVICE_LABELS = {
    bano: "Baño",
    deslanado: "Baño + Deslanado",
    corte_sin_volumen: "Baño + Corte (sin volumen)",
    corte_con_volumen: "Baño + Corte (con volumen)",
    esquila: "Baño + Esquila",
  };

  var SERVICE_ORDER = ["bano", "deslanado", "corte_sin_volumen", "corte_con_volumen", "esquila"];

  var selection = { pet: null, size: null, coat: null, service: null };

  var stepPet = root.querySelector('.price-calc-step[data-step="pet"]');
  var stepSize = root.querySelector('.price-calc-step[data-step="size"]');
  var stepCoat = root.querySelector('.price-calc-step[data-step="coat"]');
  var stepService = root.querySelector('.price-calc-step[data-step="service"]');
  var serviceOptions = stepService.querySelector('.price-calc-options[data-group="service"]');

  var resultEl = document.getElementById("price-calc-result");
  var amountEl = document.getElementById("price-calc-amount");
  var hintEl = document.getElementById("price-calc-hint");
  var resetBtn = document.getElementById("price-calc-reset");

  function reveal(el) {
    if (!el.hasAttribute("hidden")) return;
    el.hidden = false;
    el.classList.remove("price-calc-step--enter");
    void el.offsetWidth;
    el.classList.add("price-calc-step--enter");
  }

  function hide(el) {
    el.hidden = true;
    el.classList.remove("price-calc-step--enter");
  }

  function clearSelectedIn(group) {
    group.querySelectorAll(".price-calc-btn").forEach(function (b) {
      b.classList.remove("is-selected");
      b.setAttribute("aria-pressed", "false");
    });
  }

  function selectButton(group, value) {
    group.querySelectorAll(".price-calc-btn").forEach(function (b) {
      var isMatch = b.getAttribute("data-value") === value;
      b.classList.toggle("is-selected", isMatch);
      b.setAttribute("aria-pressed", isMatch ? "true" : "false");
    });
  }

  function bindGroup(group, onPick) {
    group.querySelectorAll(".price-calc-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        onPick(btn.getAttribute("data-value"));
      });
    });
  }

  bindGroup(stepPet.querySelector('.price-calc-options[data-group="pet"]'), function (value) {
    selection.pet = value;
    selection.size = null;
    selection.coat = null;
    selection.service = null;
    selectButton(stepPet.querySelector('.price-calc-options[data-group="pet"]'), value);
    hide(stepSize);
    hide(stepCoat);
    hide(stepService);
    hide(resultEl);

    if (value === "gato") {
      showGatoMessage();
    } else {
      reveal(stepSize);
    }
  });

  bindGroup(stepSize.querySelector('.price-calc-options[data-group="size"]'), function (value) {
    selection.size = value;
    selection.coat = null;
    selection.service = null;
    selectButton(stepSize.querySelector('.price-calc-options[data-group="size"]'), value);
    hide(stepService);
    hide(resultEl);
    reveal(stepCoat);
    clearSelectedIn(stepCoat.querySelector('.price-calc-options[data-group="coat"]'));
  });

  bindGroup(stepCoat.querySelector('.price-calc-options[data-group="coat"]'), function (value) {
    selection.coat = value;
    selection.service = null;
    selectButton(stepCoat.querySelector('.price-calc-options[data-group="coat"]'), value);
    hide(resultEl);
    buildServiceOptions();
    reveal(stepService);
  });

  function buildServiceOptions() {
    serviceOptions.innerHTML = "";
    var combos = ((data.perro || {})[selection.size] || {})[selection.coat] || {};

    SERVICE_ORDER.filter(function (key) {
      return typeof combos[key] === "number";
    }).forEach(function (key) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "price-calc-btn price-calc-btn--service";
      btn.setAttribute("data-value", key);
      btn.setAttribute("aria-pressed", "false");
      btn.innerHTML = "<span>" + SERVICE_LABELS[key] + "</span>";
      btn.addEventListener("click", function () {
        selection.service = key;
        selectButton(serviceOptions, key);
        showPrice(combos[key]);
      });
      serviceOptions.appendChild(btn);
    });
  }

  function showPrice(price) {
    amountEl.textContent = "$ " + price.toLocaleString("es-AR");
    hintEl.textContent =
      "Precio estimado para " +
      SIZE_LABELS[selection.size].toLowerCase() +
      " de pelo " +
      selection.coat +
      ". Puede variar según el estado de tu mascota.";
    resultEl.classList.add("is-ready");
    reveal(resultEl);
  }

  function showGatoMessage() {
    amountEl.textContent = "";
    hintEl.textContent = "Todavía no tenemos precios de gatos cargados acá. ¡Escribinos y te confirmamos el valor!";
    resultEl.classList.remove("is-ready");
    reveal(resultEl);
  }

  if (resetBtn) {
    resetBtn.addEventListener("click", function () {
      selection = { pet: null, size: null, coat: null, service: null };
      root.querySelectorAll(".price-calc-btn").forEach(function (b) {
        b.classList.remove("is-selected");
        b.setAttribute("aria-pressed", "false");
      });
      hide(stepSize);
      hide(stepCoat);
      hide(stepService);
      hide(resultEl);
      amountEl.textContent = "";
      hintEl.textContent = "";
    });
  }
})();
