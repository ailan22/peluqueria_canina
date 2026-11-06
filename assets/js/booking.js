(function () {
  const form = document.getElementById("booking-form");
  if (!form) return;

  const dateInput = document.getElementById("booking-date");
  const timeSelect = document.getElementById("booking-time");
  const submitBtn = form.querySelector("button[type=submit]");
  const statusBox = document.getElementById("booking-status");

  // Limitar el date picker a hoy .. hoy+30 días
  const today = new Date();
  const maxDate = new Date();
  maxDate.setDate(today.getDate() + 30);
  dateInput.min = today.toISOString().split("T")[0];
  dateInput.max = maxDate.toISOString().split("T")[0];

  const timeGrid = document.getElementById("booking-time-grid");

  const timeLegend = document.getElementById("booking-time-legend");
  const timeLegendSoon = document.getElementById("booking-time-legend-soon");
  const timeNotice = document.getElementById("booking-time-notice");

  function hideTimeNotice() {
    if (timeNotice) timeNotice.hidden = true;
  }

  // Aviso para los horarios libres que empiezan en menos de 1 hora: no se reservan
  // online, pero el cliente puede consultar por WhatsApp si sigue libre.
  function showSoonNotice(time) {
    if (!timeNotice) return;
    const number = (timeNotice.dataset.whatsapp || "").replace(/\D/g, "");
    const [y, m, d] = dateInput.value.split("-");
    const text = `¡Hola! Quería saber si está libre el turno del ${d}/${m}/${y} a las ${time} hs 🐶`;
    const link = number
      ? `<a class="time-notice-btn" href="https://wa.me/${number}?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">Consultar por WhatsApp</a>`
      : "";
    timeNotice.innerHTML =
      `<p>⏰ Falta menos de 1 hora para el turno de las <strong>${time}</strong>, así que no se puede reservar online.</p>` +
      `<p>Si querés ese horario, escribinos por WhatsApp y te confirmamos si está libre.</p>` +
      link;
    timeNotice.hidden = false;
  }

  function showTimeMessage(text) {
    timeSelect.value = "";
    hideTimeNotice();
    if (timeLegend) timeLegend.hidden = true;
    timeGrid.innerHTML = `<span class="time-grid-msg">${text}</span>`;
  }

  async function loadSlots() {
    timeSelect.value = "";
    const date = dateInput.value;
    if (!date) {
      showTimeMessage("Elegí una fecha primero");
      return;
    }
    showTimeMessage("Cargando...");

    try {
      const res = await fetch(`/api/availability?date=${date}`);
      const data = await res.json();

      // allSlots trae todos los horarios con su estado; si no viene, usamos slots (solo libres)
      const slots = data.allSlots || (data.slots || []).map((time) => ({ time, available: true }));

      if (slots.length === 0) {
        showTimeMessage("Sin horarios disponibles");
        return;
      }

      timeGrid.innerHTML = slots
        .map((s) => {
          if (s.available) {
            return `<button type="button" class="time-slot time-slot--free" data-time="${s.time}" aria-pressed="false">${s.time}</button>`;
          }
          if (s.status === "soon") {
            return `<button type="button" class="time-slot time-slot--soon" data-time="${s.time}" title="Falta menos de 1 hora: consultar por WhatsApp">${s.time}</button>`;
          }
          const title = s.status === "past" ? "Este horario ya pasó" : "Ocupado";
          return `<button type="button" class="time-slot time-slot--busy" disabled title="${title}">${s.time}</button>`;
        })
        .join("");
      if (timeLegend) timeLegend.hidden = false;
      if (timeLegendSoon) timeLegendSoon.hidden = !slots.some((s) => s.status === "soon");
    } catch (e) {
      showTimeMessage("Error al cargar horarios");
    }
  }

  timeGrid.addEventListener("click", (e) => {
    const soonBtn = e.target.closest(".time-slot--soon");
    if (soonBtn) {
      // No se puede elegir: deseleccionamos lo que hubiera y mostramos el aviso.
      timeGrid.querySelectorAll(".time-slot--selected").forEach((b) => {
        b.classList.remove("time-slot--selected");
        b.setAttribute("aria-pressed", "false");
      });
      timeSelect.value = "";
      showSoonNotice(soonBtn.dataset.time);
      return;
    }

    const btn = e.target.closest(".time-slot--free");
    if (!btn) return;
    hideTimeNotice();
    timeGrid.querySelectorAll(".time-slot--selected").forEach((b) => {
      b.classList.remove("time-slot--selected");
      b.setAttribute("aria-pressed", "false");
    });
    btn.classList.add("time-slot--selected");
    btn.setAttribute("aria-pressed", "true");
    timeSelect.value = btn.dataset.time;
  });

  dateInput.addEventListener("change", loadSlots);

  // Al presionar "Confirmar reserva" se muestran las condiciones como modal.
  // El turno solo se envía después de leerlas y aceptarlas.
  const conditionsModal = document.getElementById("conditions-modal");
  const conditionsAcceptBtn = document.getElementById("conditions-accept-btn");
  let conditionsAccepted = false;
  let pendingSubmit = false;

  function openConditionsModal() {
    if (!conditionsModal) return;
    conditionsModal.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeConditionsModal() {
    if (!conditionsModal) return;
    conditionsModal.hidden = true;
    document.body.style.overflow = "";
  }

  if (conditionsModal && conditionsAcceptBtn) {
    // Mostrar las condiciones apenas se abre la página de reserva.
    openConditionsModal();

    conditionsAcceptBtn.addEventListener("click", () => {
      conditionsAccepted = true;
      closeConditionsModal();
      if (pendingSubmit) {
        pendingSubmit = false;
        form.requestSubmit();
      }
    });

    conditionsModal.querySelectorAll("[data-conditions-close]").forEach((el) => {
      el.addEventListener("click", closeConditionsModal);
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !conditionsModal.hidden) closeConditionsModal();
    });
  }

  const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5MB
  const MAX_PHOTO_SIDE = 720; // px, lado más largo al redimensionar

  // Redimensiona la imagen para que su lado más largo sea maxSide y la devuelve como JPEG
  async function resizeImage(file, maxSide) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = reject;
        el.src = url;
      });
      const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
      if (!blob) throw new Error("No se pudo convertir la imagen");
      const name = (file.name || "foto").replace(/\.[^.]+$/, "") + ".jpg";
      return new File([blob], name, { type: "image/jpeg" });
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const selectedServices = Array.from(form.querySelectorAll('input[name="service"]:checked')).map((c) => c.value);
    if (selectedServices.length === 0) {
      statusBox.textContent = "Elegí un servicio.";
      statusBox.className = "booking-error";
      document.getElementById("booking-service").scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    if (!timeSelect.value) {
      statusBox.textContent = "Elegí un horario disponible (en verde).";
      statusBox.className = "booking-error";
      timeGrid.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    if (!conditionsAccepted) {
      pendingSubmit = true;
      openConditionsModal();
      return;
    }

    submitBtn.disabled = true;
    statusBox.textContent = "Enviando...";
    statusBox.className = "";

    let photo1 = form.photo1.files[0];
    if (photo1 && photo1.size > MAX_PHOTO_BYTES) {
      try {
        photo1 = await resizeImage(photo1, MAX_PHOTO_SIDE);
      } catch (err) {
        photo1 = null;
      }
      if (!photo1 || photo1.size > MAX_PHOTO_BYTES) {
        statusBox.textContent = "No pudimos procesar la foto. Probá con otra o enviá la reserva sin foto.";
        statusBox.className = "booking-error";
        submitBtn.disabled = false;
        return;
      }
    }

    const payload = new FormData();
    payload.append("owner_name", form.owner_name.value);
    payload.append("name", form.name.value);
    payload.append("phone", form.phone.value);
    payload.append("race", form.race.value);
    payload.append("pickup_method", form.pickup_method.value);
    selectedServices.forEach((s) => payload.append("service", s));
    payload.append("notes", form.notes.value);
    payload.append("date", dateInput.value);
    payload.append("time", timeSelect.value);
    if (photo1) payload.append("photo1", photo1);

    try {
      const res = await fetch("/api/book", {
        method: "POST",
        body: payload,
      });
      const data = await res.json();

      if (!res.ok) {
        statusBox.textContent = data.error || "Error al reservar";
        statusBox.className = "booking-error";
        // Si el horario ya fue tomado, recargar la lista
        if (res.status === 409) loadSlots();
      } else {
        statusBox.textContent = `¡Turno confirmado para el ${data.date} a las ${data.time}!`;
        statusBox.className = "booking-success";
        form.reset();
        showTimeMessage("Elegí una fecha primero");
        if (typeof window.showBookingSuccess === "function") {
          window.showBookingSuccess(`Te esperamos el ${data.date} a las ${data.time} hs.`);
        }
      }
    } catch (err) {
      statusBox.textContent = "Error de conexión, intentá de nuevo";
      statusBox.className = "booking-error";
    } finally {
      submitBtn.disabled = false;
    }
  });
})();
