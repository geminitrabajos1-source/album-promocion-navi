/* ==========================================================================
   ÁLBUM COLABORATIVO EN VIVO - PROMOCIÓN NAVI (I.E. GLORIABAMBA DE BOLÍVAR)
   Lógica de interfaz, compresión móvil, subida por fragmentos y visor en vivo.
   Nota de seguridad: No existen funciones ni botones para editar o eliminar
   recuerdos ya publicados (solo lectura y creación).
   ========================================================================== */

(() => {
  "use strict";

  /**
   * CONFIGURACIÓN PRINCIPAL
   * Pega aquí la URL de tu Web App publicada desde Google Apps Script (Code.gs).
   * Mientras esté vacía (""), la página funcionará en Modo Demostración con datos
   * de ejemplo para que puedas probar toda la experiencia visual e interactiva.
   */
  const CONFIG = {
    APPS_SCRIPT_URL: "https://script.google.com/macros/s/AKfycbwVP2W2N-w9DoBJGoCssdSv1-7krvwA4BvN4s6Hd7qJXFpbNSw3RNZaOST_NNXzpWx3/exec",
    MAX_VIDEO_BYTES: 300 * 1024 * 1024, // 300 MB máximo por video
    MAX_IMAGE_INPUT_BYTES: 35 * 1024 * 1024, // 35 MB antes de compresión
    DIRECT_UPLOAD_LIMIT_BYTES: 12 * 1024 * 1024, // Hasta 12 MB en 1 sola petición
    CHUNK_SIZE_BYTES: 3 * 1024 * 1024, // 3 MiB (múltiplo exacto de 256 KiB exigido por Drive)
    IMAGE_MAX_DIMENSION: 1600,
    IMAGE_QUALITY: 0.82,
    PAGE_SIZE: 12
  };

  const STORAGE_KEY_CODE = "navi_event_code";

  // Estado global de la aplicación
  const state = {
    selectedFiles: [], // Archivos pendientes antes de enviar
    memories: [], // Publicaciones cargadas (en vivo o demo)
    filteredMemories: [],
    currentFilter: "todos",
    visibleCount: CONFIG.PAGE_SIZE,
    activeModalIndex: -1,
    isSubmitting: false,
    eventCode: "",
    allowUploads: true,
    // ── INICIO CAMBIO: límite-video-v1 ──────────────────────────────────────
    // Para revertir: borrar esta línea (_activeVideoEl)
    _activeVideoEl: null   // referencia al iframe/video activo en el modal
    // ── FIN CAMBIO: límite-video-v1 ─────────────────────────────────────────
  };

  // Referencias al DOM
  const dom = {
    networkBanner: document.getElementById("aviso-conexion"),
    networkText: document.getElementById("aviso-conexion-texto"),
    accessPanel: document.getElementById("panel-acceso"),
    protectedContent: document.getElementById("contenido-protegido"),
    accessForm: document.getElementById("form-acceso"),
    inputClave: document.getElementById("input-clave-evento"),
    btnDesbloquear: document.getElementById("btn-desbloquear"),
    feedbackAcceso: document.getElementById("feedback-acceso"),
    uploadsClosedBanner: document.getElementById("aviso-subidas-cerradas"),
    form: document.getElementById("form-recuerdo"),
    inputNombre: document.getElementById("input-nombre"),
    inputMensaje: document.getElementById("input-mensaje"),
    charCounter: document.getElementById("contador-caracteres"),
    inputArchivos: document.getElementById("input-archivos"),
    dropzone: document.getElementById("dropzone-archivos"),
    previewGrid: document.getElementById("lista-previsualizacion"),
    progressBox: document.getElementById("progreso-envio"),
    progressText: document.getElementById("progreso-texto"),
    progressPercent: document.getElementById("progreso-porcentaje"),
    progressBar: document.getElementById("progreso-barra"),
    feedbackBox: document.getElementById("feedback-formulario"),
    btnEnviar: document.getElementById("btn-enviar"),
    livePill: document.getElementById("estado-fuente"),
    livePillText: document.getElementById("estado-fuente-texto"),
    filterBtns: Array.from(document.querySelectorAll(".filter-btn")),
    countTodos: document.getElementById("count-todos"),
    countImagen: document.getElementById("count-imagen"),
    countVideo: document.getElementById("count-video"),
    countTexto: document.getElementById("count-texto"),
    btnRecargar: document.getElementById("btn-recargar"),
    galleryLoading: document.getElementById("galeria-cargando"),
    galleryGrid: document.getElementById("grid-galeria"),
    galleryEmpty: document.getElementById("galeria-vacia"),
    paginationWrap: document.getElementById("paginacion-wrap"),
    btnCargarMas: document.getElementById("btn-cargar-mas"),
    modal: document.getElementById("modal-visor"),
    modalMedia: document.getElementById("modal-media"),
    modalAutor: document.getElementById("modal-autor"),
    modalMensaje: document.getElementById("modal-mensaje"),
    modalTipo: document.getElementById("modal-tipo"),
    modalFecha: document.getElementById("modal-fecha"),
    modalCerrar: document.getElementById("modal-cerrar"),
    modalPrev: document.getElementById("modal-prev"),
    modalNext: document.getElementById("modal-next")
  };

  /* ========================================================================
     1. DATOS DE EJEMPLO (MODO DEMOSTRACIÓN)
     Se muestran automáticamente mientras CONFIG.APPS_SCRIPT_URL esté vacío.
     ======================================================================== */
  function createSvgPosterDataUri(title, subtitle, accentColor) {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600">
        <defs>
          <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#07090E"/>
            <stop offset="55%" stop-color="#0F172A"/>
            <stop offset="100%" stop-color="#07090E"/>
          </linearGradient>
          <linearGradient id="oro" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stop-color="#9A7B2C"/>
            <stop offset="50%" stop-color="#F3E5AB"/>
            <stop offset="100%" stop-color="#D4AF37"/>
          </linearGradient>
        </defs>
        <rect width="800" height="600" fill="url(#bg)"/>
        <rect x="28" y="28" width="744" height="544" rx="18" fill="none" stroke="url(#oro)" stroke-width="2.5" opacity="0.7"/>
        <rect x="42" y="42" width="716" height="516" rx="12" fill="none" stroke="${accentColor}" stroke-width="1" opacity="0.4"/>
        <circle cx="400" cy="240" r="95" fill="${accentColor}" opacity="0.12"/>
        <text x="400" y="245" text-anchor="middle" fill="#F3E5AB" font-family="Georgia, serif" font-size="38" font-weight="bold">${title}</text>
        <text x="400" y="305" text-anchor="middle" fill="#CBD5E1" font-family="sans-serif" font-size="22">${subtitle}</text>
        <text x="400" y="495" text-anchor="middle" fill="#38BDF8" font-family="sans-serif" font-size="18" letter-spacing="4">PROMOCIÓN NAVI · NOVIEMBRE 2026</text>
      </svg>`;
    return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
  }

  const MOCK_MEMORIES = [
    {
      id: "demo-1",
      nombre: "Egresados · Promoción Navi",
      mensaje: "¡Por fin llegó nuestra noche de gala en el Restaurante Las Gramas! Gracias a nuestros padres y profesores de la I.E. Gloriabamba de Bolívar por acompañarnos hasta la meta.",
      tipo: "imagen",
      fechaISO: "2026-11-28T20:15:00-05:00",
      urlMiniatura: "assets/img/descarga.jpg",
      urlCompleta: "assets/img/descarga.jpg",
      esDemo: true
    },
    {
      id: "demo-2",
      nombre: "Docente · Tutoría 5.° Grado",
      mensaje: "Querida Promoción Navi: verlos culminar esta etapa me llena de orgullo. Lleven siempre en alto el nombre de El Huayo y de su colegio. ¡El futuro es suyo!",
      tipo: "texto",
      fechaISO: "2026-11-28T19:50:00-05:00",
      esDemo: true
    },
    {
      id: "demo-3",
      nombre: "Familia · Mamá de Lucía",
      mensaje: "Un detalle lleno de luz y cariño para todos los graduados. Que Dios bendiga cada paso que den desde hoy.",
      tipo: "imagen",
      fechaISO: "2026-11-28T19:30:00-05:00",
      urlMiniatura: "assets/img/descarga (2).jpg",
      urlCompleta: "assets/img/descarga (2).jpg",
      esDemo: true
    },
    {
      id: "demo-4",
      nombre: "Compañeros · Mesa de Honor",
      mensaje: "Video recuerdo del brindis y lanzamiento de birretes (ejemplo de reproducción en vista ampliada).",
      tipo: "video",
      fechaISO: "2026-11-28T19:10:00-05:00",
      urlMiniatura: createSvgPosterDataUri("Brindis Promoción Navi", "Video recuerdo de ejemplo", "#38BDF8"),
      urlVideoDemo: "",
      esDemo: true
    },
    {
      id: "demo-5",
      nombre: "Padrinos de Promoción",
      mensaje: "Felicitaciones a cada estudiante y familia de la I.E. Gloriabamba de Bolívar. Esta noche quedará guardada para siempre.",
      tipo: "imagen",
      fechaISO: "2026-11-28T18:45:00-05:00",
      urlMiniatura: createSvgPosterDataUri("Noche de Gala", "I.E. Gloriabamba de Bolívar", "#D4AF37"),
      urlCompleta: createSvgPosterDataUri("Noche de Gala", "I.E. Gloriabamba de Bolívar", "#D4AF37"),
      esDemo: true
    }
  ];

  /* ========================================================================
     2. INICIALIZACIÓN GENERAL
     ======================================================================== */
  document.addEventListener("DOMContentLoaded", () => {
    initParticles();
    initRevealObserver();
    initNetworkMonitor();
    initAccessGate();
    initFormHandlers();
    initGalleryHandlers();
    initLightboxHandlers();
    loadMemories();
  });

  function isLiveMode() {
    return Boolean(CONFIG.APPS_SCRIPT_URL && CONFIG.APPS_SCRIPT_URL.trim().startsWith("https://"));
  }

  function initAccessGate() {
    const urlParams = new URLSearchParams(window.location.search);
    const claveFromUrl = (urlParams.get("clave") || "").trim();

    if (claveFromUrl) {
      state.eventCode = claveFromUrl;
      try {
        sessionStorage.setItem(STORAGE_KEY_CODE, claveFromUrl);
      } catch {
        // Ignorar si sessionStorage no está disponible
      }
      // Limpia el parámetro de la barra de dirección tras leerlo
      if (window.history && window.history.replaceState) {
        urlParams.delete("clave");
        const cleanSearch = urlParams.toString();
        const nextUrl = window.location.pathname + (cleanSearch ? `?${cleanSearch}` : "") + window.location.hash;
        window.history.replaceState({}, "", nextUrl);
      }
    } else {
      try {
        state.eventCode = (sessionStorage.getItem(STORAGE_KEY_CODE) || "").trim();
      } catch {
        state.eventCode = "";
      }
    }

    if (isLiveMode()) {
      // Ocultar contenido protegido hasta validar la clave contra Code.gs
      dom.protectedContent.hidden = true;
    }

    if (dom.accessForm) {
      dom.accessForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const entered = (dom.inputClave.value || "").trim();
        if (!entered) {
          showAccessFeedback("Ingresa el código de acceso de la invitación.");
          return;
        }
        hideAccessFeedback();
        state.eventCode = entered;
        dom.btnDesbloquear.disabled = true;
        dom.btnDesbloquear.textContent = "Verificando...";
        await loadMemories({ fromAccessForm: true });
        dom.btnDesbloquear.disabled = false;
        dom.btnDesbloquear.textContent = "Ingresar al álbum";
      });
    }
  }

  function showAccessGate(errorMsg) {
    dom.protectedContent.hidden = true;
    dom.accessPanel.hidden = false;
    if (errorMsg) {
      showAccessFeedback(errorMsg);
    }
  }

  function unlockAlbumContent(allowUploads) {
    dom.accessPanel.hidden = true;
    dom.protectedContent.hidden = false;
    hideAccessFeedback();
    try {
      if (state.eventCode) {
        sessionStorage.setItem(STORAGE_KEY_CODE, state.eventCode);
      }
    } catch {
      // Ignorar
    }

    state.allowUploads = allowUploads !== false;
    if (dom.uploadsClosedBanner && dom.form) {
      dom.uploadsClosedBanner.hidden = state.allowUploads;
      dom.form.hidden = !state.allowUploads;
    }
  }

  function showAccessFeedback(msg) {
    if (!dom.feedbackAcceso) return;
    dom.feedbackAcceso.hidden = false;
    dom.feedbackAcceso.className = "form-feedback is-error";
    dom.feedbackAcceso.textContent = msg;
  }

  function hideAccessFeedback() {
    if (!dom.feedbackAcceso) return;
    dom.feedbackAcceso.hidden = true;
    dom.feedbackAcceso.textContent = "";
  }

  /* ========================================================================
     3. PARTÍCULAS DORADAS LIGERAS Y SCROLL REVEAL
     ======================================================================== */
  function initParticles() {
    const canvas = document.getElementById("particulas-doradas");
    if (!canvas) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = 0;
    let height = 0;
    let animationId = null;
    const isMobile = window.innerWidth < 768;
    const count = isMobile ? 22 : 38;

    const particles = Array.from({ length: count }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: Math.random() * 1.9 + 0.7,
      vy: Math.random() * 0.00028 + 0.00012,
      vx: (Math.random() - 0.5) * 0.00016,
      alpha: Math.random() * 0.55 + 0.2,
      isNavy: Math.random() < 0.18
    }));

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function draw() {
      ctx.clearRect(0, 0, width, height);
      for (const p of particles) {
        p.y -= p.vy;
        p.x += p.vx;
        if (p.y < -0.02) {
          p.y = 1.02;
          p.x = Math.random();
        }
        if (p.x < 0) p.x = 1;
        if (p.x > 1) p.x = 0;

        ctx.beginPath();
        ctx.arc(p.x * width, p.y * height, p.r, 0, Math.PI * 2);
        ctx.fillStyle = p.isNavy
          ? `rgba(56, 189, 248, ${p.alpha * 0.8})`
          : `rgba(243, 229, 171, ${p.alpha})`;
        ctx.fill();
      }
      animationId = requestAnimationFrame(draw);
    }

    resize();
    draw();
    window.addEventListener("resize", resize, { passive: true });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
      } else if (!document.hidden && !animationId) {
        draw();
      }
    });
  }

  function initRevealObserver() {
    const items = document.querySelectorAll(".reveal");
    if (!("IntersectionObserver" in window)) {
      items.forEach((el) => el.classList.add("is-visible"));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.08 }
    );

    items.forEach((el) => observer.observe(el));
  }

  /* ========================================================================
     4. DETECCIÓN DE CONEXIÓN MÓVIL LENTA / OFFLINE
     ======================================================================== */
  function initNetworkMonitor() {
    function updateStatus() {
      if (!navigator.onLine) {
        dom.networkBanner.hidden = false;
        dom.networkText.textContent =
          "Sin conexión a internet en este momento. Conéctate para enviar tus recuerdos al álbum.";
        return;
      }

      const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      if (conn && (conn.saveData || conn.effectiveType === "slow-2g" || conn.effectiveType === "2g")) {
        dom.networkBanner.hidden = false;
        dom.networkText.textContent =
          "Conexión móvil lenta detectada: tus fotos se comprimen automáticamente y los videos tardarán un poco más.";
        return;
      }

      dom.networkBanner.hidden = true;
    }

    updateStatus();
    window.addEventListener("online", updateStatus);
    window.addEventListener("offline", updateStatus);
    if (navigator.connection) {
      navigator.connection.addEventListener("change", updateStatus);
    }
  }

  /* ========================================================================
     5. FORMULARIO, VALIDACIÓN Y PREVISUALIZACIÓN DE ARCHIVOS
     ======================================================================== */
  function initFormHandlers() {
    // Chips rápidos para prefijar vínculo
    document.querySelectorAll(".chip-btn").forEach((chip) => {
      chip.addEventListener("click", () => {
        const prefix = chip.getAttribute("data-prefix") || "";
        const current = dom.inputNombre.value.trim();
        const cleaned = current.replace(/^(Egresado\/a|Familia|Docente|Invitado\/a)\s*·\s*/i, "");
        dom.inputNombre.value = prefix + cleaned;
        dom.inputNombre.focus();
      });
    });

    // Contador de caracteres de la dedicatoria
    dom.inputMensaje.addEventListener("input", () => {
      dom.charCounter.textContent = `${dom.inputMensaje.value.length} / 500`;
    });

    // Selección de archivos mediante input
    dom.inputArchivos.addEventListener("change", (event) => {
      handleSelectedFiles(event.target.files);
      event.target.value = "";
    });

    // Soporte arrastrar y soltar en escritorio
    ["dragenter", "dragover"].forEach((evt) => {
      dom.dropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        dom.dropzone.classList.add("is-dragover");
      });
    });

    ["dragleave", "drop"].forEach((evt) => {
      dom.dropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        dom.dropzone.classList.remove("is-dragover");
      });
    });

    dom.dropzone.addEventListener("drop", (e) => {
      if (e.dataTransfer && e.dataTransfer.files) {
        handleSelectedFiles(e.dataTransfer.files);
      }
    });

    dom.form.addEventListener("submit", handleFormSubmit);
  }

  function handleSelectedFiles(fileList) {
    hideFeedback();
    const files = Array.from(fileList || []);
    if (!files.length) return;

    const warnings = [];

    for (const file of files) {
      const isImage = file.type.startsWith("image/");
      const isVideo = file.type.startsWith("video/");

      if (!isImage && !isVideo) {
        warnings.push(`"${file.name}" no es una foto ni un video válido.`);
        continue;
      }

      if (isVideo && file.size > CONFIG.MAX_VIDEO_BYTES) {
        warnings.push(
          `El video "${file.name}" pesa ${formatBytes(file.size)} y supera el máximo permitido de 300 MB.`
        );
        continue;
      }

      if (isImage && file.size > CONFIG.MAX_IMAGE_INPUT_BYTES) {
        warnings.push(`La foto "${file.name}" supera el límite de 35 MB.`);
        continue;
      }

      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const previewUrl = isImage ? URL.createObjectURL(file) : null;
      state.selectedFiles.push({ id, file, isImage, isVideo, previewUrl });
    }

    if (warnings.length) {
      showFeedback(warnings.join(" "), "error");
    }

    renderPendingPreviews();
  }

  function renderPendingPreviews() {
    dom.previewGrid.replaceChildren();

    if (!state.selectedFiles.length) {
      dom.previewGrid.hidden = true;
      return;
    }

    dom.previewGrid.hidden = false;

    for (const entry of state.selectedFiles) {
      const card = document.createElement("div");
      card.className = "preview-item";

      if (entry.isImage && entry.previewUrl) {
        const img = document.createElement("img");
        img.className = "preview-thumb";
        img.src = entry.previewUrl;
        img.alt = entry.file.name;
        card.appendChild(img);
      } else {
        const badge = document.createElement("div");
        badge.className = "preview-video-badge";
        badge.innerHTML = "<span>▶</span><span>Video listo</span>";
        card.appendChild(badge);
      }

      const meta = document.createElement("div");
      meta.className = "preview-meta";

      const nameEl = document.createElement("div");
      nameEl.className = "preview-name";
      nameEl.textContent = entry.file.name;

      const sizeEl = document.createElement("div");
      sizeEl.className = "preview-size";
      sizeEl.textContent = formatBytes(entry.file.size);

      meta.append(nameEl, sizeEl);
      card.appendChild(meta);

      // Permitir quitar un archivo de la cola ANTES de enviarlo
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "preview-remove";
      removeBtn.setAttribute("aria-label", `Quitar ${entry.file.name}`);
      removeBtn.textContent = "✕";
      removeBtn.addEventListener("click", () => {
        if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
        state.selectedFiles = state.selectedFiles.filter((f) => f.id !== entry.id);
        renderPendingPreviews();
      });

      card.appendChild(removeBtn);
      dom.previewGrid.appendChild(card);
    }
  }

  /* ========================================================================
     6. ENVÍO AL BACKEND (GOOGLE APPS SCRIPT) O MODO DEMO
     ======================================================================== */
  async function handleFormSubmit(event) {
    event.preventDefault();
    if (state.isSubmitting) return;

    hideFeedback();
    const nombre = dom.inputNombre.value.trim();
    const mensaje = dom.inputMensaje.value.trim();

    if (nombre.length < 2) {
      showFeedback("Por favor ingresa tu nombre o vínculo (ej. Mamá de..., Docente, Egresado).", "error");
      dom.inputNombre.focus();
      return;
    }

    if (mensaje.length < 3) {
      showFeedback("Escribe una dedicatoria o comentario para la Promoción Navi.", "error");
      dom.inputMensaje.focus();
      return;
    }

    if (isLiveMode() && !navigator.onLine) {
      showFeedback("No tienes conexión a internet. Verifica tus datos o Wi-Fi e inténtalo de nuevo.", "error");
      return;
    }

    setSubmittingState(true);

    try {
      const grupoId = `grp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const filesToSend = [...state.selectedFiles];

      if (!isLiveMode()) {
        await submitInDemoMode(nombre, mensaje, filesToSend, grupoId);
      } else {
        await submitToAppsScript(nombre, mensaje, filesToSend, grupoId);
      }

      // Limpiar formulario tras envío exitoso
      dom.form.reset();
      dom.charCounter.textContent = "0 / 500";
      state.selectedFiles = [];
      renderPendingPreviews();

      showFeedback(
        isLiveMode()
          ? "¡Recuerdo publicado con éxito en el álbum de la Promoción Navi! Gracias por ser parte de esta noche."
          : "¡Publicado en el modo de prueba local! Configura la URL de Google Apps Script en js/app.js para guardarlo en Google Drive.",
        "success"
      );

      // Llevar suavemente hacia la galería para ver la publicación recién agregada
      setTimeout(() => {
        document.getElementById("galeria-en-vivo").scrollIntoView({ behavior: "smooth", block: "start" });
      }, 450);
    } catch (err) {
      console.error("Error al publicar recuerdo:", err);
      showFeedback(
        err.message || "Ocurrió un inconveniente al subir tu recuerdo. Revisa tu señal e inténtalo nuevamente.",
        "error"
      );
    } finally {
      setSubmittingState(false);
      hideProgress();
    }
  }

  async function submitInDemoMode(nombre, mensaje, filesToSend, grupoId) {
    const now = new Date().toISOString();

    if (!filesToSend.length) {
      updateProgress("Guardando dedicatoria en vista previa...", 100);
      await delay(300);
      state.memories.unshift({
        id: `demo-local-${Date.now()}`,
        nombre,
        mensaje,
        tipo: "texto",
        fechaISO: now,
        grupoId,
        esDemo: true
      });
    } else {
      for (let i = 0; i < filesToSend.length; i++) {
        const entry = filesToSend[i];
        const basePct = Math.round((i / filesToSend.length) * 100);
        updateProgress(`Procesando archivo ${i + 1} de ${filesToSend.length}...`, Math.max(15, basePct));
        await delay(350);

        const localUrl = URL.createObjectURL(entry.file);
        state.memories.unshift({
          id: `demo-local-${Date.now()}-${i}`,
          nombre,
          mensaje,
          tipo: entry.isVideo ? "video" : "imagen",
          fechaISO: now,
          urlMiniatura: entry.isImage ? localUrl : createSvgPosterDataUri("Video subido (Demo)", entry.file.name, "#38BDF8"),
          urlCompleta: entry.isImage ? localUrl : "",
          urlVideoDemo: entry.isVideo ? localUrl : "",
          grupoId,
          esDemo: true
        });
      }
      updateProgress("¡Listo!", 100);
    }

    refreshGalleryUI();
  }

  async function submitToAppsScript(nombre, mensaje, filesToSend, grupoId) {
    // Caso A: Dedicatoria de texto sin archivos adjuntos
    if (!filesToSend.length) {
      updateProgress("Publicando dedicatoria...", 55);
      const res = await postToAppsScript({
        action: "create_entry",
        nombre,
        mensaje,
        tipo: "texto",
        grupoId
      });
      if (res.item) {
        state.memories.unshift(normalizeServerItem(res.item));
      }
      updateProgress("¡Publicado!", 100);
      refreshGalleryUI();
      return;
    }

    // Caso B: Uno o varios archivos multimedia
    const totalFiles = filesToSend.length;
    for (let i = 0; i < totalFiles; i++) {
      const entry = filesToSend[i];
      let fileToUpload = entry.file;

      if (entry.isImage) {
        updateProgress(
          `Optimizando foto ${i + 1} de ${totalFiles} para envío rápido...`,
          Math.round((i / totalFiles) * 100)
        );
        fileToUpload = await compressImageFile(entry.file);
      }

      if (fileToUpload.size <= CONFIG.DIRECT_UPLOAD_LIMIT_BYTES) {
        // Subida directa en 1 petición
        updateProgress(
          `Subiendo archivo ${i + 1} de ${totalFiles}...`,
          Math.round(((i + 0.5) / totalFiles) * 100)
        );
        const base64 = await blobToBase64(fileToUpload);
        const res = await postToAppsScript({
          action: "create_entry",
          nombre,
          mensaje,
          tipo: entry.isVideo ? "video" : "imagen",
          fileName: fileToUpload.name,
          mimeType: fileToUpload.type || (entry.isVideo ? "video/mp4" : "image/jpeg"),
          fileSize: fileToUpload.size,
          fileBase64: base64,
          grupoId
        });
        if (res.item) {
          state.memories.unshift(normalizeServerItem(res.item));
        }
      } else {
        // Subida por fragmentos para videos grandes (hasta 300 MB)
        const item = await uploadLargeFileInChunks({
          file: fileToUpload,
          nombre,
          mensaje,
          tipo: entry.isVideo ? "video" : "imagen",
          grupoId,
          fileIndex: i,
          totalFiles
        });
        if (item) {
          state.memories.unshift(normalizeServerItem(item));
        }
      }
    }

    updateProgress("¡Recuerdo guardado en Google Drive!", 100);
    refreshGalleryUI();
  }

  async function uploadLargeFileInChunks({ file, nombre, mensaje, tipo, grupoId, fileIndex, totalFiles }) {
    const mimeType = file.type || "video/mp4";
    updateProgress(`Iniciando subida de video (${formatBytes(file.size)})...`, 5);

    const initRes = await postToAppsScript({
      action: "init_resumable",
      fileName: file.name,
      mimeType,
      fileSize: file.size
    });

    if (!initRes.uploadUrl) {
      throw new Error("No se pudo iniciar la sesión de subida para el video grande.");
    }

    const totalBytes = file.size;
    const chunkSize = CONFIG.CHUNK_SIZE_BYTES;
    const totalChunks = Math.ceil(totalBytes / chunkSize);
    let uploadedItem = null;

    for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
      const start = chunkIdx * chunkSize;
      const end = Math.min(start + chunkSize, totalBytes);
      const slice = file.slice(start, end);
      const chunkBase64 = await blobToBase64(slice);

      const overallPct = Math.round(
        ((fileIndex + (chunkIdx + 1) / totalChunks) / totalFiles) * 100
      );
      updateProgress(
        `Subiendo video ${fileIndex + 1}/${totalFiles} · Parte ${chunkIdx + 1} de ${totalChunks}...`,
        overallPct
      );

      const chunkRes = await postToAppsScript({
        action: "upload_chunk",
        uploadUrl: initRes.uploadUrl,
        uniqueFileName: initRes.uniqueFileName,
        mimeType,
        startByte: start,
        endByte: end - 1,
        totalBytes,
        chunkBase64,
        nombre,
        mensaje,
        tipo,
        grupoId
      });

      if (chunkRes.completed && chunkRes.item) {
        uploadedItem = chunkRes.item;
      }
    }

    return uploadedItem;
  }

  async function postToAppsScript(payload) {
    // Se usa text/plain para evitar preflight CORS OPTIONS en Google Apps Script
    const bodyWithAuth = {
      ...payload,
      clave: state.eventCode || ""
    };

    const response = await fetch(CONFIG.APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(bodyWithAuth),
      redirect: "follow"
    });

    if (!response.ok) {
      throw new Error(`El servidor respondió con estado ${response.status}.`);
    }

    const data = await response.json();
    if (!data.ok) {
      if (data.authError) {
        showAccessGate(data.error || "Código de acceso incorrecto.");
      }
      if (data.uploadsClosed && dom.uploadsClosedBanner && dom.form) {
        dom.uploadsClosedBanner.hidden = false;
        dom.form.hidden = true;
      }
      throw new Error(data.error || "No se pudo guardar el recuerdo.");
    }
    return data;
  }

  /* ========================================================================
     7. COMPRESIÓN DE IMÁGENES EN CLIENTE (OPTIMIZACIÓN MÓVIL)
     ======================================================================== */
  async function compressImageFile(file) {
    // No recomprimir GIF animados o archivos ya muy livianos
    if (file.type === "image/gif" || file.size < 350 * 1024) {
      return file;
    }

    try {
      const img = await loadImageFromFile(file);
      const maxDim = CONFIG.IMAGE_MAX_DIMENSION;
      let { width, height } = img;

      if (width > maxDim || height > maxDim) {
        if (width >= height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);

      const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", CONFIG.IMAGE_QUALITY)
      );

      if (!blob || blob.size >= file.size) {
        return file;
      }

      const cleanName = file.name.replace(/\.[^.]+$/, "") + ".jpg";
      return new File([blob], cleanName, { type: "image/jpeg" });
    } catch {
      return file;
    }
  }

  function loadImageFromFile(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("No se pudo decodificar la imagen"));
      };
      img.src = url;
    });
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || "");
        const commaIndex = result.indexOf(",");
        resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
      };
      reader.onerror = () => reject(new Error("Error leyendo el archivo seleccionado."));
      reader.readAsDataURL(blob);
    });
  }

  /* ========================================================================
     8. CARGA Y RENDERIZADO DE LA GALERÍA EN VIVO
     ======================================================================== */
  function initGalleryHandlers() {
    dom.filterBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        dom.filterBtns.forEach((b) => {
          b.classList.remove("is-active");
          b.setAttribute("aria-selected", "false");
        });
        btn.classList.add("is-active");
        btn.setAttribute("aria-selected", "true");
        state.currentFilter = btn.getAttribute("data-filter") || "todos";
        state.visibleCount = CONFIG.PAGE_SIZE;
        renderGallery();
      });
    });

    dom.btnRecargar.addEventListener("click", () => {
      loadMemories();
    });

    dom.btnCargarMas.addEventListener("click", () => {
      state.visibleCount += CONFIG.PAGE_SIZE;
      renderGallery();
    });
  }

  async function loadMemories(options = {}) {
    if (!isLiveMode()) {
      unlockAlbumContent(true);
      dom.livePill.classList.remove("is-connected");
      dom.livePillText.textContent = "Modo demostración (datos de ejemplo)";
      state.memories = [...MOCK_MEMORIES];
      refreshGalleryUI();
      return;
    }

    dom.livePill.classList.add("is-connected");
    dom.livePillText.textContent = "Conectado en vivo a Google Drive";
    dom.galleryLoading.hidden = false;
    dom.galleryEmpty.hidden = true;

    try {
      const claveParam = encodeURIComponent(state.eventCode || "");
      const url = `${CONFIG.APPS_SCRIPT_URL}?action=list&limit=200&clave=${claveParam}&t=${Date.now()}`;
      const response = await fetch(url, { redirect: "follow" });
      if (!response.ok) throw new Error("No se pudieron obtener los recuerdos.");
      const data = await response.json();

      if (!data.ok && data.authError) {
        state.eventCode = "";
        try {
          sessionStorage.removeItem(STORAGE_KEY_CODE);
        } catch {
          // Ignorar
        }
        showAccessGate(
          options.fromAccessForm
            ? "Código incorrecto. Verifica la clave de la invitación o escanea el QR del evento."
            : ""
        );
        return;
      }

      if (!data.ok || !Array.isArray(data.items)) {
        throw new Error(data.error || "Respuesta inválida del servidor.");
      }

      unlockAlbumContent(data.allowUploads);
      state.memories = data.items.map(normalizeServerItem);
      refreshGalleryUI();
    } catch (err) {
      console.error("Error cargando galería:", err);
      if (options.fromAccessForm || !state.eventCode) {
        showAccessGate("No se pudo conectar con el servidor para validar tu acceso. Revisa tu conexión e inténtalo de nuevo.");
        return;
      }
      dom.protectedContent.hidden = false;
      dom.livePill.classList.remove("is-connected");
      dom.livePillText.textContent = "Sin conexión al servidor · Mostrando vista de respaldo";
      if (!state.memories.length) {
        state.memories = [...MOCK_MEMORIES];
      }
      refreshGalleryUI();
    } finally {
      dom.galleryLoading.hidden = true;
    }
  }

  function normalizeServerItem(raw) {
    const fileId = raw.driveFileId || "";
    const tipo = raw.tipo === "video" ? "video" : raw.tipo === "imagen" ? "imagen" : "texto";
    return {
      id: raw.id || `item-${Math.random().toString(36).slice(2)}`,
      nombre: raw.nombre || "Invitado/a",
      mensaje: raw.mensaje || "",
      tipo,
      fechaISO: raw.fechaISO || "",
      driveFileId: fileId,
      urlMiniatura:
        raw.urlMiniatura ||
        (fileId ? `https://drive.google.com/thumbnail?id=${fileId}&sz=w800` : ""),
      urlCompleta:
        raw.urlCompleta ||
        (fileId ? `https://drive.google.com/thumbnail?id=${fileId}&sz=w1600` : ""),
      urlEmbedVideo: fileId ? `https://drive.google.com/file/d/${fileId}/preview` : "",
      esDemo: false
    };
  }

  function refreshGalleryUI() {
    updateFilterCounts();
    renderGallery();
  }

  function updateFilterCounts() {
    const total = state.memories.length;
    const imgs = state.memories.filter((m) => m.tipo === "imagen").length;
    const vids = state.memories.filter((m) => m.tipo === "video").length;
    const texts = state.memories.filter((m) => m.tipo === "texto").length;

    dom.countTodos.textContent = String(total);
    dom.countImagen.textContent = String(imgs);
    dom.countVideo.textContent = String(vids);
    dom.countTexto.textContent = String(texts);
  }

  function renderGallery() {
    state.filteredMemories =
      state.currentFilter === "todos"
        ? state.memories
        : state.memories.filter((item) => item.tipo === state.currentFilter);

    dom.galleryGrid.replaceChildren();

    if (!state.filteredMemories.length) {
      dom.galleryEmpty.hidden = false;
      dom.paginationWrap.hidden = true;
      return;
    }

    dom.galleryEmpty.hidden = true;
    const slice = state.filteredMemories.slice(0, state.visibleCount);

    slice.forEach((item, index) => {
      dom.galleryGrid.appendChild(createMemoryCard(item, index));
    });

    dom.paginationWrap.hidden = state.visibleCount >= state.filteredMemories.length;
  }

  function createMemoryCard(item, indexInFiltered) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = `memory-card${item.tipo === "texto" ? " is-text-only" : ""}`;
    card.setAttribute("aria-label", `Abrir recuerdo de ${item.nombre}`);
    card.addEventListener("click", () => openLightbox(indexInFiltered));

    if (item.tipo === "imagen") {
      const wrap = document.createElement("div");
      wrap.className = "memory-thumb-wrap";

      // ── INICIO CAMBIO: quitar-badge-foto-v1 ─────────────────────────────────
      // Para revertir: descomentar las 3 líneas de abajo y borrar este comentario
      // const badge = document.createElement("span");
      // badge.className = "media-badge";
      // badge.textContent = "📷 Foto";
      // ── FIN CAMBIO: quitar-badge-foto-v1 ────────────────────────────────────

      const img = document.createElement("img");
      img.src = item.urlMiniatura || item.urlCompleta;
      img.alt = `Recuerdo compartido por ${item.nombre}`;
      img.loading = "lazy";
      img.decoding = "async";

      wrap.append(img);
      card.appendChild(wrap);
    } else if (item.tipo === "video") {
      const wrap = document.createElement("div");
      wrap.className = "memory-thumb-wrap";

      const badge = document.createElement("span");
      badge.className = "media-badge";
      badge.textContent = "🎬 Video";
      wrap.appendChild(badge);

      const placeholder = document.createElement("div");
      placeholder.className = "video-placeholder";
      const play = document.createElement("span");
      play.className = "video-play-circle";
      play.textContent = "▶";
      const label = document.createElement("span");
      label.textContent = "Tocar para reproducir video";
      label.style.fontSize = "0.82rem";
      label.style.color = "#cbd5e1";
      placeholder.append(play, label);

      // Si existe miniatura (Drive o demo), se muestra con botón de reproducción superpuesto
      if (item.urlMiniatura) {
        const img = document.createElement("img");
        img.src = item.urlMiniatura;
        img.alt = `Video compartido por ${item.nombre}`;
        img.loading = "lazy";
        img.decoding = "async";
        img.onerror = () => {
          img.remove();
        };
        wrap.appendChild(img);
        placeholder.style.position = "absolute";
        placeholder.style.inset = "0";
        placeholder.style.background = "rgba(7, 9, 14, 0.38)";
      }

      wrap.appendChild(placeholder);
      card.appendChild(wrap);
    } else {
      const top = document.createElement("div");
      top.className = "text-quote-banner";
      const q = document.createElement("span");
      q.className = "quote-mark";
      q.textContent = "“";
      const badge = document.createElement("span");
      badge.className = "media-badge";
      badge.textContent = "✍ Dedicatoria";
      top.append(q, badge);
      card.appendChild(top);
    }

    const body = document.createElement("div");
    body.className = "memory-body";

    const author = document.createElement("h3");
    author.className = "memory-author";
    author.textContent = item.nombre;

    const comment = document.createElement("p");
    comment.className = "memory-comment";
    comment.textContent = item.mensaje;

    const footer = document.createElement("div");
    footer.className = "memory-footer";

    const dateSpan = document.createElement("span");
    dateSpan.textContent = formatShortDate(item.fechaISO);

    const hintSpan = document.createElement("span");
    hintSpan.className = "memory-open-hint";
    hintSpan.textContent = "Ampliar →";

    footer.append(dateSpan, hintSpan);
    body.append(author, comment, footer);
    card.appendChild(body);

    return card;
  }

  /* ========================================================================
     9. VISOR LIGHTBOX (VISTA AMPLIADA CON NAVEGACIÓN TÁCTIL Y TECLADO)
     ======================================================================== */

  // ── INICIO CAMBIO: límite-video-v1 ────────────────────────────────────────
  // Función auxiliar: detiene y destruye cualquier video/iframe activo en el
  // modal sin borrar el archivo de Google Drive.
  // Para revertir: borrar todo el bloque desde "INICIO CAMBIO" hasta
  // "FIN CAMBIO" (esta función completa, ~10 líneas).
  function stopActiveVideo_() {
    if (!state._activeVideoEl) return;
    const el = state._activeVideoEl;
    if (typeof el.pause === "function") el.pause();   // <video> nativo
    if (el.src !== undefined) el.src = "";            // libera la conexión
    el.remove();                                       // saca el nodo del DOM
    state._activeVideoEl = null;
  }
  // ── FIN CAMBIO: límite-video-v1 ───────────────────────────────────────────

  function initLightboxHandlers() {
    dom.modalCerrar.addEventListener("click", closeLightbox);
    dom.modal.addEventListener("click", (e) => {
      if (e.target && e.target.getAttribute("data-close-modal") === "true") {
        closeLightbox();
      }
    });

    dom.modalPrev.addEventListener("click", () => navigateLightbox(-1));
    dom.modalNext.addEventListener("click", () => navigateLightbox(1));

    document.addEventListener("keydown", (e) => {
      if (dom.modal.hidden) return;
      if (e.key === "Escape") closeLightbox();
      if (e.key === "ArrowLeft") navigateLightbox(-1);
      if (e.key === "ArrowRight") navigateLightbox(1);
    });

    // Soporte de deslizamiento táctil (swipe) en celulares
    let touchStartX = 0;
    dom.modal.addEventListener(
      "touchstart",
      (e) => {
        if (e.changedTouches && e.changedTouches.length) {
          touchStartX = e.changedTouches[0].clientX;
        }
      },
      { passive: true }
    );

    dom.modal.addEventListener(
      "touchend",
      (e) => {
        if (!e.changedTouches || !e.changedTouches.length) return;
        const deltaX = e.changedTouches[0].clientX - touchStartX;
        if (Math.abs(deltaX) > 55) {
          navigateLightbox(deltaX > 0 ? -1 : 1);
        }
      },
      { passive: true }
    );
  }

  function openLightbox(index) {
    if (index < 0 || index >= state.filteredMemories.length) return;
    state.activeModalIndex = index;
    renderLightboxContent();
    dom.modal.hidden = false;
    document.body.style.overflow = "hidden";
    dom.modalCerrar.focus();
  }

  function closeLightbox() {
    dom.modal.hidden = true;
    // ── INICIO CAMBIO: límite-video-v1 ──────────────────────────────────────
    // Para revertir: borrar desde "INICIO CAMBIO" hasta "FIN CAMBIO" (esta función)
    // y reemplazar por: dom.modalMedia.replaceChildren();
    stopActiveVideo_();
    // ── FIN CAMBIO: límite-video-v1 ─────────────────────────────────────────
    dom.modalMedia.replaceChildren();
    document.body.style.overflow = "";
    state.activeModalIndex = -1;
  }

  function navigateLightbox(step) {
    if (!state.filteredMemories.length) return;
    // ── INICIO CAMBIO: límite-video-v1 ──────────────────────────────────────
    // Para revertir: borrar esta línea stopActiveVideo_()
    stopActiveVideo_();
    // ── FIN CAMBIO: límite-video-v1 ─────────────────────────────────────────
    const total = state.filteredMemories.length;
    state.activeModalIndex = (state.activeModalIndex + step + total) % total;
    renderLightboxContent();
  }

  function renderLightboxContent() {
    const item = state.filteredMemories[state.activeModalIndex];
    if (!item) return;

    dom.modalMedia.replaceChildren();
    dom.modalAutor.textContent = item.nombre;
    dom.modalMensaje.textContent = item.mensaje;
    dom.modalFecha.textContent = formatShortDate(item.fechaISO);

    const hasMultiple = state.filteredMemories.length > 1;
    dom.modalPrev.hidden = !hasMultiple;
    dom.modalNext.hidden = !hasMultiple;

    if (item.tipo === "imagen") {
      dom.modalTipo.textContent = "📷 Fotografía";
      const img = document.createElement("img");
      img.src = item.urlCompleta || item.urlMiniatura;
      img.alt = `Fotografía compartida por ${item.nombre}`;
      dom.modalMedia.appendChild(img);
    } else if (item.tipo === "video") {
      dom.modalTipo.textContent = "🎬 Video";
      if (item.urlVideoDemo) {
        const video = document.createElement("video");
        video.src = item.urlVideoDemo;
        video.controls = true;
        video.playsInline = true;
        dom.modalMedia.appendChild(video);
      } else if (item.urlEmbedVideo) {
        // ── INICIO CAMBIO: límite-video-v1 ──────────────────────────────────
        // ANTES (carga inmediata del iframe — revertir borrando desde aquí
        // hasta "FIN CAMBIO" y pegando de vuelta el bloque original):
        //
        //   const iframe = document.createElement("iframe");
        //   iframe.src = item.urlEmbedVideo;
        //   iframe.allow = "autoplay; fullscreen";
        //   iframe.allowFullscreen = true;
        //   iframe.title = `Video de ${item.nombre}`;
        //   dom.modalMedia.appendChild(iframe);
        //
        // AHORA: pantalla de espera — el iframe solo se crea cuando el usuario
        // toca ▶, evitando cargar el video de Drive sin confirmación.
        const playScreen = document.createElement("div");
        playScreen.className = "video-lazy-screen";
        playScreen.setAttribute("role", "button");
        playScreen.setAttribute("tabindex", "0");
        playScreen.setAttribute("aria-label", "Tocar para reproducir el video");
        playScreen.style.cssText = [
          "display:flex", "flex-direction:column", "align-items:center",
          "justify-content:center", "gap:14px", "width:100%",
          "min-height:220px", "cursor:pointer",
          "background:rgba(7,9,14,0.72)", "border-radius:12px",
          "color:#F3E5AB"
        ].join(";");

        const playIcon = document.createElement("span");
        playIcon.textContent = "▶";
        playIcon.style.cssText = "font-size:3rem;line-height:1;text-shadow:0 2px 12px #0008";

        const playHint = document.createElement("span");
        playHint.textContent = "Tocar para reproducir";
        playHint.style.cssText = "font-size:0.9rem;opacity:0.8";

        playScreen.append(playIcon, playHint);

        const loadVideo = () => {
          stopActiveVideo_();
          const iframe = document.createElement("iframe");
          iframe.src = item.urlEmbedVideo;
          iframe.allow = "autoplay; fullscreen";
          iframe.allowFullscreen = true;
          iframe.title = `Video de ${item.nombre}`;
          // Referencia global para poder detenerlo después
          state._activeVideoEl = iframe;
          playScreen.replaceWith(iframe);
        };

        playScreen.addEventListener("click", loadVideo);
        playScreen.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); loadVideo(); }
        });

        dom.modalMedia.appendChild(playScreen);
        // ── FIN CAMBIO: límite-video-v1 ──────────────────────────────────────
      } else {
        const box = document.createElement("div");
        box.className = "lightbox-text-stage";
        box.textContent =
          "Vista previa de video en Modo Demostración. Cuando conectes Google Apps Script (Code.gs), aquí se reproducirá el video alojado en Google Drive.";
        dom.modalMedia.appendChild(box);
      }
    } else {
      dom.modalTipo.textContent = "✍ Dedicatoria";
      const quoteBox = document.createElement("div");
      quoteBox.className = "lightbox-text-stage";
      quoteBox.textContent = `“${item.mensaje}”`;
      dom.modalMedia.appendChild(quoteBox);
    }
  }

  /* ========================================================================
     10. UTILIDADES DE INTERFAZ
     ======================================================================== */
  function setSubmittingState(isBusy) {
    state.isSubmitting = isBusy;
    dom.btnEnviar.disabled = isBusy;
    const label = dom.btnEnviar.querySelector(".btn-label");
    if (label) {
      label.textContent = isBusy ? "Publicando recuerdo..." : "Publicar en el álbum en vivo";
    }
  }

  function updateProgress(text, percent) {
    dom.progressBox.hidden = false;
    dom.progressText.textContent = text;
    const pct = Math.max(0, Math.min(100, percent));
    dom.progressPercent.textContent = `${pct}%`;
    dom.progressBar.style.width = `${pct}%`;
  }

  function hideProgress() {
    dom.progressBox.hidden = true;
    dom.progressBar.style.width = "0%";
  }

  function showFeedback(message, type) {
    dom.feedbackBox.hidden = false;
    dom.feedbackBox.className = `form-feedback ${type === "success" ? "is-success" : "is-error"}`;
    dom.feedbackBox.textContent = message;
  }

  function hideFeedback() {
    dom.feedbackBox.hidden = true;
    dom.feedbackBox.textContent = "";
  }

  function formatBytes(bytes) {
    if (!bytes) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    const idx = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    const val = bytes / Math.pow(1024, idx);
    return `${val.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
  }

  function formatShortDate(iso) {
    if (!iso) return "Noviembre 2026";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "Noviembre 2026";
    return date.toLocaleString("es-PE", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
})();
