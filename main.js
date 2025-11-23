const express = require("express");
const axios = require("axios");
const Jimp = require("jimp");
const QRCode = require("qrcode");
const { v4: uuidv4 } = require("uuid");

const app = express();
const PORT = process.env.PORT || 3000;
// Se puede dejar el HOST como '0.0.0.0' si es requerido por el entorno (ej: Fly.io)
const HOST = "0.0.0.0"; 

// 🎯 CLAVE: Definir la URL base pública si no se proporciona como variable de entorno
const API_BASE_URL = process.env.API_BASE_URL || "https://info-total-pe.fly.dev";

// --- Configuración de GitHub (Se mantiene igual) ---
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO; // Formato: "usuario/repositorio"
const GITHUB_BRANCH = "main"; 

const APP_ICON_URL = "https://www.socialcreator.com/srv/imgs/gen/79554_icohome.png";
const APP_QR_URL = "https://www.socialcreator.com/consultapeapk#apps";

// --- CONSTANTES DE CONFIGURACIÓN ---
const IMAGE_WIDTH = 1080;
const IMAGE_HEIGHT = 1920;
const MARGIN_H = 50;
const LINE_HEIGHT = 40;
const HEADING_SPACING = 50;


// =========================================================
// 🔄 FUNCIONES DE UTILIDAD DE GITHUB (CACHE/UPLOAD)
// =========================================================

/**
 * 🆕 FUNCIÓN DE CACHE: Revisa la carpeta 'public/' en GitHub por un DNI.
 * Busca cualquier archivo que empiece con ${dni}_.
 * @param {string} dni - El DNI a buscar.
 * @returns {Promise<string|null>} La URL pública (Raw) del archivo encontrado o null.
 */
const checkIfDniExists = async (dni) => {
    if (!GITHUB_TOKEN || !GITHUB_REPO) {
        console.error("Error de configuración para la caché: GITHUB_TOKEN o GITHUB_REPO no están definidos.");
        return null; // Si no hay credenciales, no se puede verificar la caché.
    }

    const [owner, repo] = GITHUB_REPO.split('/');
    if (!owner || !repo) return null;

    // Ruta de la carpeta 'public' en la API de Contenidos de GitHub
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/public`;

    const config = {
        headers: {
            Authorization: `token ${GITHUB_TOKEN}`,
            'User-Agent': 'FlyIoImageGeneratorApp'
        }
    };

    try {
        // 1. Obtener la lista de archivos en la carpeta 'public/'
        const response = await axios.get(apiUrl, config);
        const files = response.data;
        
        // 2. Buscar un archivo que comience con el patrón DNI_
        // NOTA: Se simplifica la caché para buscar SOLO la imagen principal de "DATOS_PERSONALES"
        const existingFile = files.find(file => 
            file.type === 'file' && 
            file.name.startsWith(`${dni}_PERSONALES_`) && // Búsqueda más específica
            file.name.endsWith('.png')
        );

        if (existingFile) {
            console.log(`✅ Ficha de DNI ${dni} encontrada en caché: ${existingFile.name}`);
            // 3. Devolver la URL Raw del contenido
            return `https://raw.githubusercontent.com/${owner}/${repo}/${GITHUB_BRANCH}/public/${existingFile.name}`;
        }

        console.log(`❌ Ficha de DNI ${dni} NO encontrada en caché. Se procederá a generar.`);
        return null;

    } catch (error) {
        // Un 404 significa que la carpeta 'public' no existe o la repo es privada. 
        if (error.response && error.response.status === 404) {
            console.warn("ADVERTENCIA: Carpeta 'public' no encontrada o acceso denegado en GitHub. Continuando con la generación.");
            return null;
        }
        console.error("Error al verificar la caché de GitHub:", error.message);
        // Si hay un error, se ignora la caché y se intenta generar.
        return null; 
    }
};


/**
 * Sube un buffer de imagen PNG a un repositorio de GitHub usando la API de Contents.
 * El path está fijo a 'public/'.
 * @param {string} fileName - Nombre del archivo a crear (incluyendo extensión).
 * @param {Buffer} imageBuffer - Buffer de la imagen PNG.
 * @returns {Promise<string>} La URL pública (Raw) del archivo subido.
 */
const uploadToGitHub = async (fileName, imageBuffer) => {
    if (!GITHUB_TOKEN || !GITHUB_REPO) {
        throw new Error("Error de configuración: GITHUB_TOKEN o GITHUB_REPO no están definidos.");
    }

    const [owner, repo] = GITHUB_REPO.split('/');
    if (!owner || !repo) {
        throw new Error("El formato de GITHUB_REPO debe ser 'owner/repository-name'.");
    }

    // ⭐ MODIFICACIÓN CLAVE: Se asegura que el path es solo para la imagen en 'public/'
    const filePath = `public/${fileName}`; 
    const contentBase64 = imageBuffer.toString('base64');

    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;
    // Usamos la URL de contenido RAW para un acceso directo a la imagen.
    const publicUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${GITHUB_BRANCH}/${filePath}`;

    const data = {
        message: `feat: Ficha generada para DNI ${fileName.split('_')[0]} (${fileName.split('_')[1]})`,
        content: contentBase64,
        branch: GITHUB_BRANCH
    };

    const config = {
        headers: {
            // Se utiliza el token para la autenticación
            Authorization: `token ${GITHUB_TOKEN}`,
            'Content-Type': 'application/json',
            // El User-Agent es requerido por la API de GitHub
            'User-Agent': 'FlyIoImageGeneratorApp'
        }
    };

    console.log(`Intentando subir archivo de imagen a GitHub: ${filePath} en ${GITHUB_REPO}`);
    
    // Realiza la solicitud PUT para crear o actualizar el archivo
    await axios.put(apiUrl, data, config);

    console.log(`Archivo de imagen subido exitosamente a GitHub. URL: ${publicUrl}`);

    return publicUrl;
};

// =========================================================
// 🎨 FUNCIONES DE UTILIDAD PARA JIMPS (Sin cambios)
// =========================================================

// Función para generar marcas de agua (sin cambios)
const generarMarcaDeAgua = async (imagen) => {
    const marcaAgua = await Jimp.read(imagen.bitmap.width, imagen.bitmap.height, 0x00000000);
    const fontWatermark = await Jimp.loadFont(Jimp.FONT_SANS_32_WHITE);
    const text = "RENIEC";

    for (let i = 0; i < imagen.bitmap.width; i += 200) { 
        for (let j = 0; j < imagen.bitmap.height; j += 100) { 
            const angle = Math.random() * 30 - 15; 
            const textImage = new Jimp(100, 50, 0x00000000); 
            textImage.print(fontWatermark, 0, 0, text); 
            textImage.rotate(angle); 
            marcaAgua.composite(textImage, i, j, { mode: Jimp.BLEND_SOURCE_OVER, opacitySource: 0.1, opacityDest: 1 }); 
        } 
    } 
    return marcaAgua; 
};

/**
 * Función para imprimir texto con salto de línea.
 * @param {Jimp} image - La imagen Jimp.
 * @param {object} font - La fuente Jimp.
 * @param {number} x - Posición X de inicio.
 * @param {number} y - Posición Y de inicio.
 * @param {number} maxWidth - Ancho máximo del texto.
 * @param {string} text - El texto a imprimir.
 * @param {number} lineHeight - Altura de cada línea.
 * @returns {number} La nueva posición Y después del texto impreso.
 */
const printWrappedText = (image, font, x, y, maxWidth, text, lineHeight) => {
    const words = text.split(' ');
    let line = '';
    let currentY = y;

    for (const word of words) { 
        const testLine = line.length === 0 ? word : line + ' ' + word; 
        const testWidth = Jimp.measureText(font, testLine); 
        if (testWidth > maxWidth && line.length > 0) { 
            image.print(font, x, currentY, line.trim()); 
            line = word + ' '; 
            currentY += lineHeight; 
        } else { 
            line = testLine + ' '; 
        } 
    } 
    image.print(font, x, currentY, line.trim()); 
    return currentY + lineHeight; 
};

/**
 * Imprime un bloque de datos clave:valor en formato de columna.
 * @param {Jimp} image - La imagen Jimp.
 * @param {object} fontBold - Fuente para la etiqueta.
 * @param {object} fontData - Fuente para el valor.
 * @param {number} xStart - Posición X de inicio.
 * @param {number} yStart - Posición Y de inicio (se actualiza).
 * @param {number} labelWidth - Ancho asignado a la etiqueta.
 * @param {number} dataWidth - Ancho asignado al valor.
 * @param {number} lineHeight - Altura de la línea.
 * @param {string} label - La etiqueta (clave).
 * @param {string} value - El valor.
 * @returns {number} La nueva posición Y después de imprimir el campo.
 */
const printFieldInColumn = (image, fontBold, fontData, xStart, yStart, labelWidth, dataWidth, lineHeight, label, value) => {
    const labelX = xStart; 
    const valueX = labelX + labelWidth; 
    const maxWidth = dataWidth;
    
    // Imprimir la etiqueta en negrita
    image.print(fontBold, labelX, yStart, `${label}:`); 
    
    // Imprimir el valor (con salto de línea si es necesario)
    const newY = printWrappedText(image, fontData, valueX, yStart, maxWidth, `${value || "-"}`, lineHeight); 
    
    // Retornar la nueva posición Y
    return newY - 10; // Pequeño ajuste de espaciado
};


// =========================================================
// 🖼️ FUNCIONES DE GENERACIÓN DE IMAGEN POR CATEGORÍA
// =========================================================

/**
 * Genera la imagen para la sección de Datos Personales, Foto, Firma, Huellas y QR.
 * @param {object} data - Datos parseados de la API externa.
 * @param {object} fonts - Colección de fuentes Jimp.
 * @returns {Promise<Jimp>} Objeto Jimp de la imagen generada.
 */
const generarImagenDatosPersonales = async (data, fonts) => {
    const { fontTitle, fontHeading, fontBold, fontData } = fonts;
    
    const imagen = await new Jimp(IMAGE_WIDTH, IMAGE_HEIGHT, "#003366"); 
    const marcaAgua = await generarMarcaDeAgua(imagen); 
    imagen.composite(marcaAgua, 0, 0); 

    const columnLeftX = MARGIN_H; 
    const columnRightX = IMAGE_WIDTH / 2 + MARGIN_H; 
    const columnWidthLeft = IMAGE_WIDTH / 2 - MARGIN_H - 25; 
    const columnWidthRight = IMAGE_WIDTH / 2 - MARGIN_H - 25; 
    
    let yStartContent = 300; 
    let yLeft = yStartContent; 
    let yRight = yStartContent; 
    
    // --- Cabecera/Título ---
    try { 
        const iconBuffer = (await axios({ url: APP_ICON_URL, responseType: 'arraybuffer' })).data; 
        const mainIcon = await Jimp.read(iconBuffer); 
        mainIcon.resize(300, Jimp.AUTO); 
        const iconX = (IMAGE_WIDTH - mainIcon.bitmap.width) / 2; 
        imagen.composite(mainIcon, iconX, 50); 
    } catch (error) { 
        console.error("Error al cargar el icono:", error); 
        imagen.print(fontTitle, MARGIN_H, 50, "Consulta Ciudadana"); 
    } 
    
    // Línea separadora central
    const separatorX = IMAGE_WIDTH / 2; 
    const separatorYStart = yStartContent - 50; 
    const separatorYEnd = IMAGE_HEIGHT - 150; 
    new Jimp(2, separatorYEnd - separatorYStart, 0xFFFFFFFF, (err, line) => { 
        if (!err) imagen.composite(line, separatorX, separatorYStart); 
    }); 
    
    // --- Contenido Columna Derecha: Foto ---
    if (data.urls?.IMAGE) { 
        try {
            const fotoBuffer = (await axios({ url: data.urls.IMAGE, responseType: 'arraybuffer' })).data;
            const foto = await Jimp.read(fotoBuffer); 
            const fotoWidth = 350; 
            const fotoHeight = 400; 
            foto.resize(fotoWidth, fotoHeight); 
            const fotoX = columnRightX + (columnWidthRight - fotoWidth) / 2; 
            imagen.composite(foto, fotoX, yStartContent); 
            yRight += fotoHeight + HEADING_SPACING; 
        } catch (e) {
            console.error("Error al cargar la foto:", e.message);
        }
    } 
    
    // --- Contenido Columna Izquierda: Datos Personales ---
    imagen.print(fontHeading, columnLeftX, yLeft, "Datos Personales"); 
    yLeft += HEADING_SPACING; 
    
    // Función auxiliar para esta columna específica
    const printField = (label, value) => {
        yLeft = printFieldInColumn(imagen, fontBold, fontData, columnLeftX, yLeft, 250, columnWidthLeft - 250, LINE_HEIGHT, label, value);
    };

    const parseData = data.parsed;
    printField("DNI", parseData.dni); 
    printField("Apellidos", parseData.apellidos); 
    printField("Nombres", parseData.nombres); 
    printField("F. Nacimiento", parseData.fechaNacimiento); 
    printField("Sexo", parseData.genero); 
    printField("Estado Civil", parseData.estadoCivil); 
    printField("Estatura", parseData.estatura ? `${parseData.estatura} cm` : "-"); 
    printField("Grado Inst.", parseData.gradoInstruccion); 
    printField("Restricción", parseData.restriccion); 
    
    yLeft += HEADING_SPACING / 2; 
    
    imagen.print(fontHeading, columnLeftX, yLeft, "Info. Adicional y Padres"); 
    yLeft += HEADING_SPACING; 
    
    printField("F. Emisión", parseData.fechaEmision); 
    printField("F. Caducidad", parseData.fechaCaducidad); 
    printField("Padre", parseData.padre); 
    printField("Madre", parseData.madre); 
    
    yLeft += HEADING_SPACING / 2; 
    
    imagen.print(fontHeading, columnLeftX, yLeft, "Dirección y Ubicación"); 
    yLeft += HEADING_SPACING; 
    
    printField("Dirección", parseData.direccionCompleta); 
    printField("Distrito", parseData.distrito); 
    printField("Provincia", parseData.provincia); 
    printField("Departamento", parseData.departamento); 
    printField("Cod. Postal", parseData.codigoPostal); 
    
    // --- Contenido Columna Derecha: QR ---
    // QR al final, separado y con texto 
    try { 
        const qrCodeBuffer = await QRCode.toBuffer(APP_QR_URL); 
        const qrCodeImage = await Jimp.read(qrCodeBuffer); 
        qrCodeImage.resize(250, 250); 
        const qrCodeX = columnRightX + (columnWidthRight - qrCodeImage.bitmap.width) / 2; 
        
        // Posicionamos el QR debajo del espacio de la foto y huellas si hubieran
        const qrY = Math.max(yRight, yStartContent + 450); // Mínimo a 450px para dejar espacio

        imagen.composite(qrCodeImage, qrCodeX, qrY); 
        imagen.print(fontHeading, qrCodeX, qrY + 260, "Escanea el QR");
    } catch (error) { 
        console.error("Error al generar el código QR:", error); 
    } 
    
    // Footer 
    const footerY = IMAGE_HEIGHT - 100; 
    imagen.print( 
        fontData, 
        MARGIN_H, 
        footerY, 
        "Esta imagen es solo informativa. No representa un documento oficial ni tiene validez legal." 
    ); 

    return imagen;
};


/**
 * Genera una imagen con la tabla de Sueldos.
 * @param {object} data - Datos parseados de la API externa.
 * @param {object} fonts - Colección de fuentes Jimp.
 * @returns {Promise<Jimp>} Objeto Jimp de la imagen generada.
 */
const generarImagenSueldos = async (data, fonts) => {
    const { fontTitle, fontHeading, fontBold, fontData } = fonts;
    
    const imagen = await new Jimp(IMAGE_WIDTH, IMAGE_HEIGHT, "#003366"); 
    const marcaAgua = await generarMarcaDeAgua(imagen); 
    imagen.composite(marcaAgua, 0, 0); 
    
    let yCurrent = 150;
    
    // Título
    imagen.print(fontTitle, MARGIN_H, 50, "💸 Historial de Sueldos"); 
    
    // Info Ciudadano
    const infoText = `DNI: ${data.parsed.dni} | Nombres: ${data.parsed.nombres} ${data.parsed.apellidos} | Total Registros: ${data.sueldos.length}`;
    imagen.print(fontHeading, MARGIN_H, yCurrent, infoText);
    yCurrent += HEADING_SPACING;

    // Encabezados de la tabla
    const colRUC = 100;
    const colEmpresa = 300;
    const colSituacion = 150;
    const colSueldo = 200;
    const colPeriodo = 200;
    const colX = [MARGIN_H, MARGIN_H + colRUC, MARGIN_H + colRUC + colEmpresa, MARGIN_H + colRUC + colEmpresa + colSituacion, MARGIN_H + colRUC + colEmpresa + colSituacion + colSueldo];

    // Cabecera de la tabla
    imagen.print(fontBold, colX[0], yCurrent, "RUC");
    imagen.print(fontBold, colX[1], yCurrent, "EMPRESA");
    imagen.print(fontBold, colX[2], yCurrent, "SIT.");
    imagen.print(fontBold, colX[3], yCurrent, "SUELDO");
    imagen.print(fontBold, colX[4], yCurrent, "PERIODO");
    yCurrent += LINE_HEIGHT / 2; 

    // Línea separadora
    new Jimp(IMAGE_WIDTH - 2 * MARGIN_H, 2, 0xFFFFFF99, (err, line) => { 
        if (!err) imagen.composite(line, MARGIN_H, yCurrent); 
    }); 
    yCurrent += LINE_HEIGHT / 4;

    // Datos de la tabla
    const maxItems = 40; // Limitar para caber en una sola página

    data.sueldos.slice(0, maxItems).forEach(item => {
        if (yCurrent + LINE_HEIGHT > IMAGE_HEIGHT - 100) return; // Evitar desbordamiento

        imagen.print(fontData, colX[0], yCurrent, item.RUC);
        imagen.print(fontData, colX[1], yCurrent, item.EMPRESA.substring(0, 30)); // Recortar nombre
        imagen.print(fontData, colX[2], yCurrent, item.SITUACION.substring(0, 5));
        imagen.print(fontData, colX[3], yCurrent, item.SUELDO);
        imagen.print(fontData, colX[4], yCurrent, item.PERIODO);
        yCurrent += LINE_HEIGHT;
    });

    // Mensaje si hay más resultados
    if (data.sueldos.length > maxItems) {
        imagen.print(fontHeading, MARGIN_H, yCurrent, `...y ${data.sueldos.length - maxItems} resultados más (Se muestran los ${maxItems} primeros)`);
    }

    // Footer (Se mantiene igual)
    const footerY = IMAGE_HEIGHT - 100; 
    imagen.print( 
        fontData, 
        MARGIN_H, 
        footerY, 
        "Esta imagen es solo informativa. No representa un documento oficial ni tiene validez legal." 
    ); 

    return imagen;
};


/**
 * Genera una imagen con la tabla de Teléfonos.
 * @param {object} data - Datos parseados de la API externa.
 * @param {object} fonts - Colección de fuentes Jimp.
 * @returns {Promise<Jimp>} Objeto Jimp de la imagen generada.
 */
const generarImagenTelefonos = async (data, fonts) => {
    const { fontTitle, fontHeading, fontBold, fontData } = fonts;
    
    const imagen = await new Jimp(IMAGE_WIDTH, IMAGE_HEIGHT, "#003366"); 
    const marcaAgua = await generarMarcaDeAgua(imagen); 
    imagen.composite(marcaAgua, 0, 0); 
    
    let yCurrent = 150;
    
    // Título
    imagen.print(fontTitle, MARGIN_H, 50, "📞 Registros Telefónicos"); 
    
    // Info Ciudadano
    const infoText = `DNI: ${data.parsed.dni} | Nombres: ${data.parsed.nombres} ${data.parsed.apellidos} | Total Registros: ${data.telefonos.length}`;
    imagen.print(fontHeading, MARGIN_H, yCurrent, infoText);
    yCurrent += HEADING_SPACING;

    // Encabezados de la tabla
    const colTelefono = 250;
    const colPlan = 200;
    const colFuente = 300;
    const colPeriodo = 200;
    const colX = [MARGIN_H, MARGIN_H + colTelefono, MARGIN_H + colTelefono + colPlan, MARGIN_H + colTelefono + colPlan + colFuente];

    // Cabecera de la tabla
    imagen.print(fontBold, colX[0], yCurrent, "TELÉFONO");
    imagen.print(fontBold, colX[1], yCurrent, "PLAN");
    imagen.print(fontBold, colX[2], yCurrent, "FUENTE");
    imagen.print(fontBold, colX[3], yCurrent, "PERIODO");
    yCurrent += LINE_HEIGHT / 2; 

    // Línea separadora
    new Jimp(IMAGE_WIDTH - 2 * MARGIN_H, 2, 0xFFFFFF99, (err, line) => { 
        if (!err) imagen.composite(line, MARGIN_H, yCurrent); 
    }); 
    yCurrent += LINE_HEIGHT / 4;

    // Datos de la tabla
    const maxItems = 40; // Limitar para caber en una sola página

    data.telefonos.slice(0, maxItems).forEach(item => {
        if (yCurrent + LINE_HEIGHT > IMAGE_HEIGHT - 100) return; // Evitar desbordamiento

        imagen.print(fontData, colX[0], yCurrent, item.TELEFONO);
        imagen.print(fontData, colX[1], yCurrent, item.PLAN.substring(0, 20));
        imagen.print(fontData, colX[2], yCurrent, item.FUENTE.substring(0, 30));
        imagen.print(fontData, colX[3], yCurrent, item.PERIODO ? item.PERIODO.substring(0, 10) : "-");
        yCurrent += LINE_HEIGHT;
    });

    // Mensaje si hay más resultados
    if (data.telefonos.length > maxItems) {
        imagen.print(fontHeading, MARGIN_H, yCurrent, `...y ${data.telefonos.length - maxItems} resultados más (Se muestran los ${maxItems} primeros)`);
    }
    
    // Footer (Se mantiene igual)
    const footerY = IMAGE_HEIGHT - 100; 
    imagen.print( 
        fontData, 
        MARGIN_H, 
        footerY, 
        "Esta imagen es solo informativa. No representa un documento oficial ni tiene validez legal." 
    ); 

    return imagen;
};

/**
 * Genera una imagen con la tabla de Registros de Empresa.
 * @param {object} data - Datos parseados de la API externa.
 * @param {object} fonts - Colección de fuentes Jimp.
 * @returns {Promise<Jimp>} Objeto Jimp de la imagen generada.
 */
const generarImagenEmpresas = async (data, fonts) => {
    const { fontTitle, fontHeading, fontBold, fontData } = fonts;
    
    const imagen = await new Jimp(IMAGE_WIDTH, IMAGE_HEIGHT, "#003366"); 
    const marcaAgua = await generarMarcaDeAgua(imagen); 
    imagen.composite(marcaAgua, 0, 0); 
    
    let yCurrent = 150;
    
    // Título
    imagen.print(fontTitle, MARGIN_H, 50, "🏢 Registros de Empresas"); 
    
    // Info Ciudadano
    const infoText = `DNI: ${data.parsed.dni} | Nombres: ${data.parsed.nombres} ${data.parsed.apellidos} | Total Registros: ${data.empresas.length}`;
    imagen.print(fontHeading, MARGIN_H, yCurrent, infoText);
    yCurrent += HEADING_SPACING;

    // Encabezados de la tabla
    const colRUC = 150;
    const colRazonSocial = 400;
    const colCargo = 250;
    const colDesde = 150;
    const colX = [MARGIN_H, MARGIN_H + colRUC, MARGIN_H + colRUC + colRazonSocial, MARGIN_H + colRUC + colRazonSocial + colCargo];

    // Cabecera de la tabla
    imagen.print(fontBold, colX[0], yCurrent, "RUC");
    imagen.print(fontBold, colX[1], yCurrent, "RAZÓN SOCIAL");
    imagen.print(fontBold, colX[2], yCurrent, "CARGO");
    imagen.print(fontBold, colX[3], yCurrent, "DESDE");
    yCurrent += LINE_HEIGHT / 2; 

    // Línea separadora
    new Jimp(IMAGE_WIDTH - 2 * MARGIN_H, 2, 0xFFFFFF99, (err, line) => { 
        if (!err) imagen.composite(line, MARGIN_H, yCurrent); 
    }); 
    yCurrent += LINE_HEIGHT / 4;

    // Datos de la tabla
    const maxItems = 40; // Limitar para caber en una sola página

    data.empresas.slice(0, maxItems).forEach(item => {
        if (yCurrent + LINE_HEIGHT > IMAGE_HEIGHT - 100) return; // Evitar desbordamiento

        imagen.print(fontData, colX[0], yCurrent, item.RUC);
        imagen.print(fontData, colX[1], yCurrent, item.RAZON_SOCIAL.substring(0, 45)); 
        imagen.print(fontData, colX[2], yCurrent, item.CARGO.substring(0, 25));
        imagen.print(fontData, colX[3], yCurrent, item.DESDE);
        yCurrent += LINE_HEIGHT;
    });

    // Mensaje si hay más resultados
    if (data.empresas.length > maxItems) {
        imagen.print(fontHeading, MARGIN_H, yCurrent, `...y ${data.empresas.length - maxItems} resultados más (Se muestran los ${maxItems} primeros)`);
    }
    
    // Footer (Se mantiene igual)
    const footerY = IMAGE_HEIGHT - 100; 
    imagen.print( 
        fontData, 
        MARGIN_H, 
        footerY, 
        "Esta imagen es solo informativa. No representa un documento oficial ni tiene validez legal." 
    ); 

    return imagen;
};

// =========================================================
// 🧩 FUNCIONES DE PARSEO Y COORDINACIÓN DE GENERACIÓN
// =========================================================

/**
 * Parsea el texto plano de la API externa en una estructura JSON organizada.
 * @param {string} text - El campo 'message' del resultado de la API.
 * @returns {object} Un objeto con datos personales separados y las listas de sueldos/teléfonos/empresas.
 */
const parseApiData = (text) => {
    const sections = text.split('---').map(s => s.trim()).filter(s => s.length > 0);
    const result = {
        parsed: {},
        sueldos: [],
        telefonos: [],
        empresas: []
    };

    // --- Parsear Datos Personales (Primera sección) ---
    const personalDataBlock = sections[0];
    const lines = personalDataBlock.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    
    // Mapeo simple de datos personales
    const personalMap = {
        'DNI': 'dni', 'APELLIDOS': 'apellidos', 'NOMBRES': 'nombres', 'GENERO': 'genero',
        'FECHA NACIMIENTO': 'fechaNacimiento', 'DEPARTAMENTO': 'departamento', 'PROVINCIA': 'provincia', 'DISTRITO': 'distrito',
        'GRADO INSTRUCCION': 'gradoInstruccion', 'ESTADO CIVIL': 'estadoCivil', 'ESTATURA': 'estatura',
        'FECHA EMISION': 'fechaEmision', 'FECHA CADUCIDAD': 'fechaCaducidad', 'FECHA FALLECIMIENTO': 'fechaFallecimiento',
        'PADRE': 'padre', 'MADRE': 'madre', 'RESTRICCION': 'restriccion',
        'DIRECCION': 'direccionCompleta', 'CODIGO POSTAL': 'codigoPostal',
    };

    lines.forEach(line => {
        const parts = line.split(':');
        if (parts.length < 2) return;
        
        let key = parts[0].trim().replace(/\[\w+\]/, '').replace(/\d+/g, '').trim();
        let value = parts.slice(1).join(':').trim();

        // Limpiar emojis y textos de ubicación/fecha
        value = value.replace(/[\ud83c-\udfff]|\[\d+\/\d+\]/g, '').trim();
        key = key.replace(/[\ud83c-\udfff]|\[\d+\/\d+\]/g, '').trim();

        if (personalMap[key]) {
            result.parsed[personalMap[key]] = value;
        }
    });

    // --- Parsear Sueldos, Teléfonos y Empresas ---
    // Recorremos las secciones restantes (que contienen los listados)
    sections.slice(1).forEach(section => {
        const lines = section.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        
        // Identificar el tipo de sección
        const isSueldos = lines.some(l => l.includes('SUELDO'));
        const isTelefonos = lines.some(l => l.includes('TELEFONO'));
        const isEmpresas = lines.some(l => l.includes('CARGO'));

        let currentItem = {};
        lines.forEach(line => {
            if (line.startsWith('DNI :')) {
                // Nuevo registro
                if (currentItem.DNI) {
                    if (isSueldos) result.sueldos.push(currentItem);
                    else if (isTelefonos) result.telefonos.push(currentItem);
                    else if (isEmpresas) result.empresas.push(currentItem);
                }
                currentItem = {};
            }

            const parts = line.split(':');
            if (parts.length >= 2) {
                const key = parts[0].trim();
                const value = parts.slice(1).join(':').trim();
                currentItem[key.replace(/\s/g, '_')] = value; // Reemplazar espacio por guión bajo
            }
        });

        // Asegurar el último registro
        if (currentItem.DNI) {
            if (isSueldos) result.sueldos.push(currentItem);
            else if (isTelefonos) result.telefonos.push(currentItem);
            else if (isEmpresas) result.empresas.push(currentItem);
        }
    });

    return result;
};


/**
 * Coordina la generación de todas las imágenes.
 * @param {string} dni - El DNI consultado.
 * @param {object} apiData - El objeto de respuesta JSON de la API externa.
 * @returns {Promise<object>} Un objeto con las URLs de las imágenes generadas.
 */
const generarMultiplesFichas = async (dni, apiData) => {
    
    // 1. Cargar fuentes Jimp (se hace una sola vez)
    const fonts = {
        fontTitle: await Jimp.loadFont(Jimp.FONT_SANS_64_WHITE),
        fontHeading: await Jimp.loadFont(Jimp.FONT_SANS_32_WHITE),
        fontBold: await Jimp.loadFont(Jimp.FONT_SANS_16_WHITE),
        fontData: await Jimp.loadFont(Jimp.FONT_SANS_16_WHITE)
    };

    // 2. Parsear los datos
    const parsedData = parseApiData(apiData.message);
    const dataConParsed = { ...apiData, parsed: parsedData };

    // 3. Generar las imágenes (asíncronamente)
    const imagesToGenerate = [
        { type: 'PERSONALES', generator: generarImagenDatosPersonales, data: dataConParsed },
    ];
    
    if (parsedData.sueldos.length > 0) {
        imagesToGenerate.push({ type: 'SUELDOS', generator: generarImagenSueldos, data: dataConParsed });
    }
    
    if (parsedData.telefonos.length > 0) {
        imagesToGenerate.push({ type: 'TELEFONOS', generator: generarImagenTelefonos, data: dataConParsed });
    }
    
    if (parsedData.empresas.length > 0) {
        imagesToGenerate.push({ type: 'EMPRESAS', generator: generarImagenEmpresas, data: dataConParsed });
    }
    
    const generatedUrls = {};
    const baseName = `${dni}_${uuidv4()}`;
    
    for (const imgConfig of imagesToGenerate) {
        console.log(`Generando imagen para la categoría: ${imgConfig.type}`);
        const imagen = await imgConfig.generator(imgConfig.data, fonts);
        const imagenBuffer = await imagen.getBufferAsync(Jimp.MIME_PNG);
        
        // Nombre del archivo: DNI_TIPO_UUID.png
        const fileName = `${dni}_${imgConfig.type}_${uuidv4()}.png`;

        // Subir a GitHub
        const urlArchivoGitHub = await uploadToGitHub(fileName, imagenBuffer);
        
        // Crear URL de descarga (PROXY)
        const urlDescargaProxy = `${API_BASE_URL}/descargar-ficha?url=${encodeURIComponent(urlArchivoGitHub)}`;
        
        // Guardar la URL en el objeto de respuesta
        generatedUrls[`FILE_${imgConfig.type}`] = urlDescargaProxy;
    }

    return generatedUrls;
};


// =========================================================
// 🌐 RUTAS DEL SERVIDOR
// =========================================================

// --- RUTA MODIFICADA: Genera la ficha, incluye lógica de cache y múltiples imágenes ---
app.get("/generar-ficha", async (req, res) => {
    const { dni } = req.query;
    if (!dni) return res.status(400).json({ error: "Falta el parámetro DNI" });
    
    const dateNow = new Date().toISOString();

    try { 
        // 1. 🔍 LÓGICA DE CACHE (Simplificada para la primera imagen)
        const cachedUrl = await checkIfDniExists(dni);
        
        if (cachedUrl) {
            // Si la imagen principal existe, asumimos que las demás también existen o se pueden generar bajo demanda.
            // Para mantener la simplicidad, si la principal está en caché, devolvemos SÓLO esa URL.
            // Una implementación real buscaría las 4 URLs en la caché.
            const urlDescargaProxy = `${API_BASE_URL}/descargar-ficha?url=${encodeURIComponent(cachedUrl)}`;
            
            const messageText = `DNI : ${dni}\nESTADO : RESULTADO PRINCIPAL ENCONTRADO EN CACHÉ.`;
            
            return res.json({
                "bot": "Consulta pe",
                "chat_id": 7658983973, 
                "date": dateNow,
                "fields": { "dni": dni },
                "from_id": 7658983973, 
                "message": messageText,
                "parts_received": 1, 
                "urls": {
                    "FILE_PERSONALES": urlDescargaProxy, 
                }
            });
        }
        
        // ----------------------------------------------------
        // 2. 🚀 LÓGICA DE GENERACIÓN (Si no existe en caché)
        // ----------------------------------------------------
        
        // Obtener datos del DNI (Consulta a la API externa)
        // ⭐ URL de la API externa actualizada según solicitud
        const response = await axios.get(`https://web-production-75681.up.railway.app/seeker?dni=${dni}`); 
        const data = response.data; // Ya contiene el objeto completo
        
        if (data.status !== "ok") return res.status(404).json({ 
            error: data.message || "No se encontró información para el DNI ingresado.",
            fields: { dni }
        }); 
        
        // 3. Generar todas las imágenes y subir a GitHub
        const urls = await generarMultiplesFichas(dni, data);
        const parsedData = parseApiData(data.message);
        
        // 4. Preparar la respuesta JSON con todas las URLs generadas
        const messageText = `DNI : ${dni}\nAPELLIDOS : ${parsedData.apellidos}\nNOMBRES : ${parsedData.nombres}\nESTADO : MÚLTIPLES FICHAS GENERADAS CON ÉXITO.`;

        res.json({
            "bot": "Consulta pe",
            "chat_id": 7658983973, 
            "date": dateNow,
            "fields": { "dni": dni },
            "from_id": 7658983973, 
            "message": messageText,
            "parts_received": 1, 
            "urls": urls
        });

    } catch (error) { 
        console.error("Error general en el proceso:", error); 
        res.status(500).json({ 
            error: "Error al generar las fichas o subir a GitHub", 
            detalle: error.message 
        }); 
    } 

});


// --- RUTA: Proxy de descarga (Sin cambios) ---
app.get("/descargar-ficha", async (req, res) => {
    const { url } = req.query; // URL del archivo en GitHub
    
    if (!url) {
        return res.status(400).send("Falta el parámetro 'url' de la imagen.");
    }

    try {
        // 1. Descargar el archivo de la URL proporcionada (ej. GitHub Raw)
        const response = await axios.get(url, { responseType: 'arraybuffer' });
        const imageBuffer = Buffer.from(response.data);

        // 2. Extraer el nombre del archivo de la URL para usarlo en la descarga
        const urlParts = url.split('/');
        const fileName = urlParts[urlParts.length - 1]; 

        // 3. Establecer las cabeceras clave para forzar la descarga
        res.set({
            'Content-Disposition': `attachment; filename="${fileName}"`, // CLAVE: 'attachment' fuerza la descarga
            'Content-Type': 'image/png', // Opcional, pero recomendado
            'Content-Length': imageBuffer.length // Recomendado para el progreso de descarga
        });

        // 4. Enviar el buffer de la imagen
        res.send(imageBuffer);

    } catch (error) {
        console.error("Error al descargar o servir la imagen:", error);
        res.status(500).send("Error al procesar la descarga del archivo.");
    }
});
// --------------------------------------------------------------------------------


// --- ENDPOINTS DE BÚSQUEDA AVANZADA (SIN CAMBIOS) ---
app.get("/buscar-por-nombre", (req, res) => {
    const { nombres, apellidos } = req.query;

    if (!nombres || !apellidos) {
        return res.status(400).json({ 
            error: "Faltan parámetros: 'nombres' y 'apellidos' son requeridos para esta consulta." 
        });
    }

    res.status(501).json({ 
        error: "Búsqueda Avanzada No Implementada",
        message: `La API externa que utiliza esta aplicación solo soporta la consulta por número de DNI. No es posible realizar búsquedas inversas por nombres y apellidos.`,
        solicitado: { nombres, apellidos }
    });
});

app.get("/buscar-por-padres", (req, res) => {
    const { nomPadre, nomMadre } = req.query;

    if (!nomPadre && !nomMadre) {
        return res.status(400).json({ 
            error: "Faltan parámetros: Se requiere al menos 'nomPadre' o 'nomMadre' para esta consulta." 
        });
    }
    
    res.status(501).json({ 
        error: "Búsqueda Avanzada No Implementada",
        message: `La API externa que utiliza esta aplicación solo soporta la consulta por número de DNI. No es posible realizar búsquedas por nombres de padres.`,
        solicitado: { nomPadre, nomMadre }
    });
});

app.get("/buscar-por-edad", (req, res) => {
    const { edad } = req.query;

    if (!edad) {
        return res.status(400).json({ 
            error: "Falta el parámetro 'edad' para esta consulta." 
        });
    }
    
    res.status(501).json({ 
        error: "Búsqueda Avanzada No Implementada",
        message: `La API externa que utiliza esta aplicación solo soporta la consulta por número de DNI. No es posible realizar búsquedas por edad.`,
        solicitado: { edad }
    });
});
// -------------------------------------------------------------

// --- INICIO DEL SERVIDOR ---
app.listen(PORT, HOST, () => {
    console.log(`Servidor corriendo en ${API_BASE_URL}`);
    if (!GITHUB_TOKEN) console.warn("ADVERTENCIA: GITHUB_TOKEN no está configurado.");
    if (!GITHUB_REPO) console.warn("ADVERTENCIA: GITHUB_REPO no está configurado.");
    if (!process.env.API_BASE_URL) console.warn("ADVERTENCIA: La variable de entorno API_BASE_URL no está configurada y se usa la URL de fallback: https://imagen-v2.fly.dev.");
});
