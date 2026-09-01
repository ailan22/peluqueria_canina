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

  async function loadSlots() {
    timeSelect.innerHTML = "<option>Cargando...</option>";
    timeSelect.disabled = true;

    const date = dateInput.value;
    if (!date) return;

    try {
      const res = await fetch(`/api/availability?date=${date}`);
      const data = await res.json();

      if (!data.slots || data.slots.length === 0) {
        timeSelect.innerHTML = "<option value=''>Sin horarios disponibles</option>";
        return;
      }

      timeSelect.innerHTML = data.slots
        .map((s) => `<option value="${s}">${s}</option>`)
        .join("");
      timeSelect.disabled = false;
    } catch (e) {
      timeSelect.innerHTML = "<option value=''>Error al cargar horarios</option>";
    }
  }

  dateInput.addEventListener("change", loadSlots);

  // El turno solo se puede reservar después de leer y aceptar las condiciones.
  const conditionsBtn = document.getElementById("conditions-btn");
  const conditionsModal = document.getElementById("conditions-modal");
  const conditionsAcceptBtn = document.getElementById("conditions-accept-btn");
  let conditionsAccepted = false;

  function openConditionsModal() {
    conditionsModal.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeConditionsModal() {
    conditionsModal.hidden = true;
    document.body.style.overflow = "";
  }

  if (conditionsBtn && conditionsModal && conditionsAcceptBtn) {
    conditionsBtn.addEventListener("click", openConditionsModal);

    conditionsAcceptBtn.addEventListener("click", () => {
      conditionsAccepted = true;
      submitBtn.disabled = false;
      closeConditionsModal();
    });

    conditionsModal.querySelectorAll("[data-conditions-close]").forEach((el) => {
      el.addEventListener("click", closeConditionsModal);
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !conditionsModal.hidden) closeConditionsModal();
    });
  }

  const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5MB

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    if (!conditionsAccepted) {
      openConditionsModal();
      return;
    }

    const photo1 = form.photo1.files[0];    
    for (const photo of [photo1]) {
      if (photo && photo.size > MAX_PHOTO_BYTES) {
        statusBox.textContent = "Cada foto debe pesar menos de 5MB";
        statusBox.className = "booking-error";
        return;
      }
    }

    submitBtn.disabled = true;
    statusBox.textContent = "Enviando...";
    statusBox.className = "";

    const payload = new FormData();
    payload.append("name", form.name.value);
    payload.append("phone", form.phone.value);
    payload.append("race", form.race.value);
    payload.append("pickup_method", form.pickup_method.value);
    payload.append("service", form.service.value);
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
        timeSelect.innerHTML = "<option value=''>Elegí una fecha primero</option>";
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
