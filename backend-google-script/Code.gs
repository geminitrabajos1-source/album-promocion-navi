/**
 * ============================================================================
 * BACKEND SERVERLESS EN GOOGLE APPS SCRIPT - ÁLBUM PROMOCIÓN NAVI
 * Institución Educativa: I.E. Gloriabamba de Bolívar (El Huayo, Cajabamba)
 * Evento: Ceremonia y Fiesta de Graduación - Noviembre 2026
 *
 * CARACTERÍSTICAS:
 * - Almacena fotos y videos en una carpeta de Google Drive con nombre único.
 * - Registra cada recuerdo y dedicatoria en una hoja de Google Sheets.
 * - Soporta subida directa (fotos/clips <= 15 MB) y subida por fragmentos
 *   (videos grandes hasta 300 MB) usando la API reanudable de Google Drive.
 * - INMUTABILIDAD ESTRICTA: Solo existen acciones de creación (doPost) y
 *   lectura (doGet). No existe ningún endpoint ni función para editar o borrar.
 *
 * INSTRUCCIONES DE DESPLIEGUE:
 * 1. Entra a https://script.google.com y crea un nuevo proyecto.
 * 2. Pega todo este código en el archivo Code.gs.
 * 3. (Opcional) Si ya creaste una carpeta en Drive o una hoja de cálculo,
 *    coloca sus IDs en CONFIG.FOLDER_ID y CONFIG.SPREADSHEET_ID. Si los dejas
 *    vacíos, el script los creará automáticamente en tu Drive la primera vez.
 * 4. Haz clic en "Implementar" -> "Nueva implementación" -> tipo "Aplicación web".
 *    - Ejecutar como: "Yo" (tu cuenta de Google).
 *    - Quién tiene acceso: "Cualquier persona".
 * 5. Autoriza los permisos de Drive, Sheets y conexión externa (UrlFetchApp).
 * 6. Copia la URL de la aplicación web y pégala en CONFIG.APPS_SCRIPT_URL
 *    dentro de js/app.js.
 * ============================================================================
 */

const CONFIG = {
  // Clave de acceso al evento para evitar que personas ajenas ingresen o suban archivos.
  // Cámbiala por la clave que pondrás en tu QR (?clave=TU_CLAVE) o déjala en "" para desactivar.
  EVENT_CODE: "",
  // Cambia a false después de la fiesta para cerrar nuevas subidas (el álbum queda solo lectura).
  ALLOW_UPLOADS: true,
  // Opcional: pega aquí el ID de tu carpeta de Google Drive (o déjalo vacío para creación automática)
  FOLDER_ID: "",
  // Opcional: pega aquí el ID de tu Google Sheet (o déjalo vacío para creación automática)
  SPREADSHEET_ID: "",
  DEFAULT_FOLDER_NAME: "Álbum Graduación - Promoción Navi (2026)",
  DEFAULT_SHEET_TITLE: "Registro Álbum Promoción Navi (2026)",
  SHEET_NAME: "Recuerdos",
  MAX_VIDEO_BYTES: 300 * 1024 * 1024, // 300 MB máximo
  MAX_DIRECT_BYTES: 15 * 1024 * 1024, // 15 MB en una sola petición
  MAX_NAME_LENGTH: 100,
  MAX_MESSAGE_LENGTH: 600
};

const DRIVE_RESUMABLE_PREFIX = "https://www.googleapis.com/upload/drive/v3/files";

/**
 * Endpoint GET: Devuelve las publicaciones recientes para la galería en vivo.
 * Valida la clave del evento antes de entregar los datos.
 * Solo lectura. No modifica ni elimina registros.
 */
function doGet(e) {
  try {
    const params = (e && e.parameter) ? e.parameter : {};
    if (!isAuthorizedEventCode_(params.clave)) {
      return jsonResponse_({
        ok: false,
        authError: true,
        error: "Código de acceso al evento incorrecto o faltante."
      });
    }

    const limit = Math.min(Math.max(parseInt(params.limit || "200", 10) || 200, 1), 500);
    const offset = Math.max(parseInt(params.offset || "0", 10) || 0, 0);

    const sheet = getOrCreateSheet_();
    const lastRow = sheet.getLastRow();

    if (lastRow <= 1) {
      return jsonResponse_({
        ok: true,
        items: [],
        total: 0,
        allowUploads: CONFIG.ALLOW_UPLOADS
      });
    }

    // Columnas:
    // 1:ID | 2:FechaISO | 3:Nombre | 4:Mensaje | 5:Tipo | 6:ArchivoNombre
    // 7:MimeType | 8:TamanoBytes | 9:DriveFileId | 10:UrlCompleta | 11:UrlMiniatura | 12:GrupoId
    const rows = sheet.getRange(2, 1, lastRow - 1, 12).getValues();
    const total = rows.length;

    // Invertir para mostrar primero los recuerdos más recientes
    const reversed = rows.slice().reverse();
    const paged = reversed.slice(offset, offset + limit).map(function (row) {
      const fileId = String(row[8] || "");
      const tipo = String(row[4] || "texto");
      return {
        id: String(row[0] || ""),
        fechaISO: row[1] instanceof Date ? row[1].toISOString() : String(row[1] || ""),
        nombre: String(row[2] || ""),
        mensaje: String(row[3] || ""),
        tipo: tipo,
        archivoNombre: String(row[5] || ""),
        mimeType: String(row[6] || ""),
        tamanoBytes: Number(row[7] || 0),
        driveFileId: fileId,
        urlCompleta: String(row[9] || (fileId ? buildImageUrl_(fileId, 1600) : "")),
        urlMiniatura: String(row[10] || (fileId ? buildImageUrl_(fileId, 800) : "")),
        grupoId: String(row[11] || "")
      };
    });

    return jsonResponse_({
      ok: true,
      items: paged,
      total: total,
      allowUploads: CONFIG.ALLOW_UPLOADS
    });
  } catch (err) {
    return jsonResponse_({ ok: false, error: "Error al leer el álbum: " + err.message });
  }
}

/**
 * Endpoint POST: Permite únicamente crear nuevos recuerdos y subir archivos.
 * Valida la clave del evento y si las subidas están abiertas.
 * No existen acciones de edición ni eliminación.
 */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse_({ ok: false, error: "Solicitud vacía." });
    }

    const body = JSON.parse(e.postData.contents);

    if (!isAuthorizedEventCode_(body.clave)) {
      return jsonResponse_({
        ok: false,
        authError: true,
        error: "Código de acceso al evento incorrecto o faltante."
      });
    }

    if (!CONFIG.ALLOW_UPLOADS) {
      return jsonResponse_({
        ok: false,
        uploadsClosed: true,
        error: "La recepción de nuevos recuerdos ha finalizado. El álbum está en modo solo lectura."
      });
    }

    const action = String(body.action || "create_entry");

    if (action === "create_entry") {
      return handleCreateEntry_(body);
    }

    if (action === "init_resumable") {
      return handleInitResumable_(body);
    }

    if (action === "upload_chunk") {
      return handleUploadChunk_(body);
    }

    return jsonResponse_({ ok: false, error: "Acción no permitida." });
  } catch (err) {
    return jsonResponse_({ ok: false, error: "Error en el servidor: " + err.message });
  }
}

/**
 * Crea una dedicatoria de texto o guarda un archivo directo (<= 15 MB) en Drive.
 */
function handleCreateEntry_(body) {
  const nombre = sanitizeText_(body.nombre, CONFIG.MAX_NAME_LENGTH);
  const mensaje = sanitizeText_(body.mensaje, CONFIG.MAX_MESSAGE_LENGTH);
  const grupoId = sanitizeText_(body.grupoId || "", 60);

  if (!nombre || nombre.length < 2) {
    return jsonResponse_({ ok: false, error: "El nombre o vínculo es obligatorio." });
  }
  if (!mensaje || mensaje.length < 3) {
    return jsonResponse_({ ok: false, error: "La dedicatoria o comentario es obligatorio." });
  }

  const hasFile = Boolean(body.fileBase64);
  let tipo = "texto";
  let uniqueFileName = "";
  let mimeType = "";
  let fileSize = 0;
  let driveFileId = "";
  let urlCompleta = "";
  let urlMiniatura = "";

  if (hasFile) {
    mimeType = String(body.mimeType || "application/octet-stream");
    if (!isAllowedMime_(mimeType)) {
      return jsonResponse_({ ok: false, error: "Solo se permiten imágenes y videos." });
    }

    const bytes = Utilities.base64Decode(body.fileBase64);
    fileSize = bytes.length;
    if (fileSize > CONFIG.MAX_DIRECT_BYTES) {
      return jsonResponse_({
        ok: false,
        error: "El archivo supera el tamaño de subida directa; debe enviarse por fragmentos."
      });
    }

    tipo = mimeType.indexOf("video/") === 0 ? "video" : "imagen";
    uniqueFileName = buildUniqueFileName_(body.fileName || (tipo === "video" ? "video.mp4" : "foto.jpg"));

    const folder = getOrCreateFolder_();
    const blob = Utilities.newBlob(bytes, mimeType, uniqueFileName);
    const file = folder.createFile(blob);

    // Permiso público de solo lectura para que todos los invitados puedan ver el álbum
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    driveFileId = file.getId();
    urlCompleta = tipo === "video" ? buildVideoPreviewUrl_(driveFileId) : buildImageUrl_(driveFileId, 1600);
    urlMiniatura = buildImageUrl_(driveFileId, 800);
  }

  const item = appendMemoryRow_({
    nombre: nombre,
    mensaje: mensaje,
    tipo: tipo,
    archivoNombre: uniqueFileName,
    mimeType: mimeType,
    tamanoBytes: fileSize,
    driveFileId: driveFileId,
    urlCompleta: urlCompleta,
    urlMiniatura: urlMiniatura,
    grupoId: grupoId
  });

  return jsonResponse_({ ok: true, item: item });
}

/**
 * Inicia una sesión de subida reanudable en Google Drive (para videos de hasta 300 MB).
 */
function handleInitResumable_(body) {
  const mimeType = String(body.mimeType || "video/mp4");
  const fileSize = Number(body.fileSize || 0);

  if (!isAllowedMime_(mimeType)) {
    return jsonResponse_({ ok: false, error: "Tipo de archivo no permitido." });
  }
  if (!fileSize || fileSize <= 0 || fileSize > CONFIG.MAX_VIDEO_BYTES) {
    return jsonResponse_({
      ok: false,
      error: "El tamaño del video debe ser mayor a 0 y no superar los 300 MB."
    });
  }

  const folder = getOrCreateFolder_();
  const uniqueFileName = buildUniqueFileName_(body.fileName || "video_graduacion.mp4");

  const initResponse = UrlFetchApp.fetch(
    DRIVE_RESUMABLE_PREFIX + "?uploadType=resumable",
    {
      method: "post",
      headers: {
        Authorization: "Bearer " + ScriptApp.getOAuthToken(),
        "X-Upload-Content-Type": mimeType,
        "X-Upload-Content-Length": String(fileSize)
      },
      contentType: "application/json",
      payload: JSON.stringify({
        name: uniqueFileName,
        parents: [folder.getId()]
      }),
      muteHttpExceptions: true
    }
  );

  const code = initResponse.getResponseCode();
  const headers = initResponse.getHeaders();
  const uploadUrl = headers["Location"] || headers["location"] || "";

  if ((code !== 200 && code !== 201) || !uploadUrl) {
    return jsonResponse_({
      ok: false,
      error: "No se pudo preparar la subida en Drive (código " + code + ")."
    });
  }

  return jsonResponse_({
    ok: true,
    uploadUrl: uploadUrl,
    uniqueFileName: uniqueFileName
  });
}

/**
 * Envía un fragmento del archivo a la sesión reanudable de Google Drive.
 * Cuando llega el último fragmento, asigna permisos de lectura y registra en Sheets.
 */
function handleUploadChunk_(body) {
  const uploadUrl = String(body.uploadUrl || "");
  if (uploadUrl.indexOf(DRIVE_RESUMABLE_PREFIX) !== 0) {
    return jsonResponse_({ ok: false, error: "URL de sesión de subida inválida." });
  }

  const mimeType = String(body.mimeType || "video/mp4");
  const startByte = Number(body.startByte);
  const endByte = Number(body.endByte);
  const totalBytes = Number(body.totalBytes);

  if (
    !Number.isFinite(startByte) ||
    !Number.isFinite(endByte) ||
    !Number.isFinite(totalBytes) ||
    totalBytes <= 0 ||
    totalBytes > CONFIG.MAX_VIDEO_BYTES ||
    startByte < 0 ||
    endByte < startByte
  ) {
    return jsonResponse_({ ok: false, error: "Rango de bytes inválido." });
  }

  const chunkBytes = Utilities.base64Decode(body.chunkBase64 || "");
  const expectedLength = endByte - startByte + 1;
  if (chunkBytes.length !== expectedLength) {
    return jsonResponse_({ ok: false, error: "El tamaño del fragmento no coincide." });
  }

  const putResponse = UrlFetchApp.fetch(uploadUrl, {
    method: "put",
    contentType: mimeType,
    headers: {
      "Content-Range": "bytes " + startByte + "-" + endByte + "/" + totalBytes
    },
    payload: chunkBytes,
    muteHttpExceptions: true
  });

  const code = putResponse.getResponseCode();

  // 308 Resume Incomplete: fragmento recibido correctamente, faltan más partes
  if (code === 308) {
    return jsonResponse_({ ok: true, completed: false });
  }

  // 200 / 201: subida finalizada completamente en Google Drive
  if (code === 200 || code === 201) {
    const fileMeta = JSON.parse(putResponse.getContentText() || "{}");
    const driveFileId = String(fileMeta.id || "");
    if (!driveFileId) {
      return jsonResponse_({ ok: false, error: "Drive finalizó sin devolver el ID del archivo." });
    }

    const file = DriveApp.getFileById(driveFileId);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    const nombre = sanitizeText_(body.nombre, CONFIG.MAX_NAME_LENGTH) || "Invitado/a";
    const mensaje = sanitizeText_(body.mensaje, CONFIG.MAX_MESSAGE_LENGTH) || "";
    const tipo = mimeType.indexOf("video/") === 0 ? "video" : "imagen";
    const uniqueFileName = sanitizeText_(body.uniqueFileName || file.getName(), 180);
    const grupoId = sanitizeText_(body.grupoId || "", 60);

    const item = appendMemoryRow_({
      nombre: nombre,
      mensaje: mensaje,
      tipo: tipo,
      archivoNombre: uniqueFileName,
      mimeType: mimeType,
      tamanoBytes: totalBytes,
      driveFileId: driveFileId,
      urlCompleta: tipo === "video" ? buildVideoPreviewUrl_(driveFileId) : buildImageUrl_(driveFileId, 1600),
      urlMiniatura: buildImageUrl_(driveFileId, 800),
      grupoId: grupoId
    });

    return jsonResponse_({ ok: true, completed: true, item: item });
  }

  return jsonResponse_({
    ok: false,
    error: "Error subiendo fragmento a Drive (código " + code + ")."
  });
}

/* ============================================================================
 * FUNCIONES AUXILIARES (CARPETA DRIVE, HOJA SHEETS, SEGURIDAD Y FORMATO)
 * ============================================================================ */

function appendMemoryRow_(data) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = getOrCreateSheet_();
    const id = "rec_" + Utilities.getUuid().slice(0, 8);
    const fechaISO = new Date().toISOString();

    sheet.appendRow([
      id,
      fechaISO,
      escapeFormula_(data.nombre),
      escapeFormula_(data.mensaje),
      data.tipo,
      escapeFormula_(data.archivoNombre || ""),
      data.mimeType || "",
      Number(data.tamanoBytes || 0),
      data.driveFileId || "",
      data.urlCompleta || "",
      data.urlMiniatura || "",
      data.grupoId || ""
    ]);

    return {
      id: id,
      fechaISO: fechaISO,
      nombre: data.nombre,
      mensaje: data.mensaje,
      tipo: data.tipo,
      archivoNombre: data.archivoNombre || "",
      mimeType: data.mimeType || "",
      tamanoBytes: Number(data.tamanoBytes || 0),
      driveFileId: data.driveFileId || "",
      urlCompleta: data.urlCompleta || "",
      urlMiniatura: data.urlMiniatura || "",
      grupoId: data.grupoId || ""
    };
  } finally {
    lock.releaseLock();
  }
}

function getOrCreateFolder_() {
  const props = PropertiesService.getScriptProperties();
  const folderId = CONFIG.FOLDER_ID || props.getProperty("NAVI_FOLDER_ID");
  if (folderId) {
    try {
      return DriveApp.getFolderById(folderId);
    } catch (e) {
      // Si el ID guardado ya no existe, se crea una carpeta nueva abajo
    }
  }

  const existing = DriveApp.getFoldersByName(CONFIG.DEFAULT_FOLDER_NAME);
  const folder = existing.hasNext() ? existing.next() : DriveApp.createFolder(CONFIG.DEFAULT_FOLDER_NAME);
  props.setProperty("NAVI_FOLDER_ID", folder.getId());
  return folder;
}

function getOrCreateSheet_() {
  const props = PropertiesService.getScriptProperties();
  let ssId = CONFIG.SPREADSHEET_ID || props.getProperty("NAVI_SPREADSHEET_ID");
  let ss = null;

  if (ssId) {
    try {
      ss = SpreadsheetApp.openById(ssId);
    } catch (e) {
      ss = null;
    }
  }

  if (!ss) {
    const folder = getOrCreateFolder_();
    ss = SpreadsheetApp.create(CONFIG.DEFAULT_SHEET_TITLE);
    ssId = ss.getId();
    props.setProperty("NAVI_SPREADSHEET_ID", ssId);

    // Mover la hoja de cálculo dentro de la carpeta del álbum para mantener todo ordenado
    try {
      const ssFile = DriveApp.getFileById(ssId);
      ssFile.moveTo(folder);
    } catch (e) {
      // Ignorar si no se requiere mover
    }
  }

  let sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) {
    sheet = ss.getSheets()[0];
    sheet.setName(CONFIG.SHEET_NAME);
  }

  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      "ID",
      "FechaISO",
      "Nombre",
      "Mensaje",
      "Tipo",
      "ArchivoNombre",
      "MimeType",
      "TamanoBytes",
      "DriveFileId",
      "UrlCompleta",
      "UrlMiniatura",
      "GrupoId"
    ]);
    sheet.setFrozenRows(1);
  }

  return sheet;
}

function buildUniqueFileName_(originalName) {
  const tz = Session.getScriptTimeZone() || "America/Lima";
  const stamp = Utilities.formatDate(new Date(), tz, "yyyyMMdd_HHmmss");
  const uid = Utilities.getUuid().slice(0, 6);
  const safeBase = String(originalName || "archivo")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(-80);
  return stamp + "_" + uid + "_" + safeBase;
}

function buildImageUrl_(fileId, size) {
  return "https://drive.google.com/thumbnail?id=" + fileId + "&sz=w" + size;
}

function buildVideoPreviewUrl_(fileId) {
  return "https://drive.google.com/file/d/" + fileId + "/preview";
}

function isAuthorizedEventCode_(providedCode) {
  const expected = String(CONFIG.EVENT_CODE || "").trim().toUpperCase();
  if (!expected) return true;
  const given = String(providedCode || "").trim().toUpperCase();
  return given === expected;
}

function isAllowedMime_(mimeType) {
  return mimeType.indexOf("image/") === 0 || mimeType.indexOf("video/") === 0;
}

function sanitizeText_(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

// Previene inyección de fórmulas en Google Sheets manteniendo el texto intacto al leerlo
function escapeFormula_(value) {
  const text = String(value || "");
  if (/^[=+\-@]/.test(text)) {
    return "'" + text;
  }
  return text;
}

function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
