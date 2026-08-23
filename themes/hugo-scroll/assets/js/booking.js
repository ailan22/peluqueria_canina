(function () {
  const form = document.getElementById("booking-form");
  if (!form) return;

  const dateInput = document.getElementById("booking-date");
  const timeSelect = document.getElementById("booking-time");
  const statusBox = document.getElementById("booking-status");
  const submitBtn = form.querySelector("button[type=submit]");

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

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    submitBtn.disabled = true;
    statusBox.textContent = "Enviando...";
    statusBox.className = "";

    const payload = {
      name: form.name.value,
      email: form.email.value,
      phone: form.phone.value,
      service: form.service.value,
      date: dateInput.value,
      time: timeSelect.value,
    };

    try {
      const res = await fetch("/api/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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
      }
    } catch (err) {
      statusBox.textContent = "Error de conexión, intentá de nuevo";
      statusBox.className = "booking-error";
    } finally {
      submitBtn.disabled = false;
    }
  });
})();
