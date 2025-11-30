const express = require("express");
const axios = require("axios");
const Jimp = require("jimp");
const QRCode = require("qrcode");
const { v4: uuidv4 } = require("uuid");

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0"; 

// 🎯 CLAVE: Definir la URL base pública si no se proporciona como variable de entorno
const API_BASE_URL = process.env.API_BASE_URL || "https://imagen-v2.fly.dev";

// 🆕 CLAVE: La nueva URL de la API externa
const EXTERNAL_API_URL = "https://web-production-75681.up.railway.app/seeker?dni=";

// --- Configuración de GitHub ---
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO; // Formato: "usuario/repositorio"
const GITHUB_BRANCH = "main"; 

const APP_ICON_URL = "https://www.socialcreator.com/srv/imgs/gen/79554_icohome.png";
const APP_QR_URL = "https://www.socialcreator.com/consultapeapk#apps";

// --- Constantes de Diseño (para Jimp) ---
const MARGIN_HORIZONTAL = 50; 
const IMAGE_WIDTH = 1080;
const IMAGE_HEIGHT = 1920;
const COLUMN_LEFT_X = MARGIN_HORIZONTAL; 
const COLUMN_WIDTH_LEFT = IMAGE_WIDTH / 2 - MARGIN_HORIZONTAL - 25; 
const COLUMN_RIGHT_X = IMAGE_WIDTH / 2 + 50; 
const COLUMN_WIDTH_RIGHT = IMAGE_WIDTH / 2 - MARGIN_HORIZONTAL - 25; 
const LINE_HEIGHT = 40; 
const HEADING_SPACING = 50; 
const SEPARATOR_X = IMAGE_WIDTH / 2; 
const Y_START_CONTENT = 300; 
const Y_FOOTER = IMAGE_HEIGHT - 100;

// --- Funciones de Utilidad ---

/**
 * 🆕 FUNCIÓN DE CACHE: Revisa la carpeta 'public/' en GitHub por un DNI.
 * Se mantiene igual.
 */
const checkIfDniExists = async (dni) => {
    if (!GITHUB_TOKEN || !GITHUB_REPO) {
        console.error("Error de configuración para la caché: GITHUB_TOKEN o GITHUB_REPO no están definidos.");
        return null; 
    }

    const [owner, repo] = GITHUB_REPO.split('/');
    if (!owner || !repo) return null;

    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/public`;

    const config = {
        headers: {
            Authorization: `token ${GITHUB_TOKEN}`,
            'User-Agent': 'FlyIoImageGeneratorApp'
        }
    };

    try {
        const response = await axios.get(apiUrl, config);
        const files = response.data;
        
        const existingFile = files.find(file => 
            file.type === 'file' && 
            file.name.startsWith(`${dni}_`) && 
            file.name.endsWith('.png')
        );

        if (existingFile) {
            console.log(`✅ Ficha de DNI ${dni} encontrada en caché: ${existingFile.name}`);
            return `https://raw.githubusercontent.com/${owner}/${repo}/${GITHUB_BRANCH}/public/${existingFile.name}`;
        }

        console.log(`❌ Ficha de DNI ${dni} NO encontrada en caché. Se procederá a generar.`);
        return null;

    } catch (error) {
        if (error.response && error.response.status === 404) {
            console.warn("ADVERTENCIA: Carpeta 'public' no encontrada o acceso denegado en GitHub. Continuando con la generación.");
            return null;
        }
        console.error("Error al verificar la caché de GitHub:", error.message);
        return null; 
    }
};


/**
 * Sube un buffer de imagen PNG a un repositorio de GitHub.
 * Se mantiene igual.
 */
const uploadToGitHub = async (fileName, imageBuffer) => {
    if (!GITHUB_TOKEN || !GITHUB_REPO) {
        throw new Error("Error de configuración: GITHUB_TOKEN o GITHUB_REPO no están definidos.");
    }

    const [owner, repo] = GITHUB_REPO.split('/');
    if (!owner || !repo) {
        throw new Error("El formato de GITHUB_REPO debe ser 'owner/repository-name'.");
    }

    const filePath = `public/${fileName}`; 
    const contentBase64 = imageBuffer.toString('base64');
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;
    const publicUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${GITHUB_BRANCH}/${filePath}`;

    const data = {
        message: `feat: Ficha generada para DNI ${fileName.split('_')[0]}`,
        content: contentBase64,
        branch: GITHUB_BRANCH
    };

    const config = {
        headers: {
            Authorization: `token ${GITHUB_TOKEN}`,
            'Content-Type': 'application/json',
            'User-Agent': 'FlyIoImageGeneratorApp'
        }
    };

    console.log(`Intentando subir archivo de imagen a GitHub: ${filePath} en ${GITHUB_REPO}`);
    
    await axios.put(apiUrl, data, config);

    console.log(`Archivo de imagen subido exitosamente a GitHub. URL: ${publicUrl}`);

    return publicUrl;
};


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


// Función para imprimir texto con salto de línea (sin cambios)
const printWrappedText = (image, font, x, y, maxWidth, text, lineHeight) => {
    const words = text.split(' ');
    let line = '';
    let currentY = y;

    for (const word of words) { 
        const testLine = line.length === 0 ? word : line + ' ' + word; 
        const testWidth = Jimp.measureText(font, testLine); 
        if (testWidth > maxWidth) { 
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
 * Imprime una sección de datos de array (como Empresas) y maneja el desbordamiento.
 * @param {Jimp} image - Objeto Jimp de la imagen actual.
 * @param {number} startY - Posición Y inicial para empezar a dibujar.
 * @param {Array<Object>} array - Array de datos de empresas.
 * @param {string} heading - Título de la sección.
 * @param {Object} fonts - Objeto con las fuentes Jimp.
 * @param {Object} constants - Objeto con las constantes de diseño.
 * @param {boolean} isSplitPage - Si es una página de continuación (usa 2 columnas).
 * @returns {{ finalY: number, remainingArray: Array<Object> }}
 */
const printArraySection = (image, startY, array, heading, fonts, constants, isSplitPage = false) => {
    const { fontHeading, fontBold, fontData, lineHeight, headingSpacing } = fonts;
    const { columnLeftX, columnRightX, columnWidthLeft, columnWidthRight, IMAGE_HEIGHT } = constants;

    let currentY = startY;
    let remainingArray = array;

    // 1. Imprimir Título
    if (heading) {
        image.print(fontHeading, isSplitPage ? columnLeftX : columnLeftX, currentY, heading);
        currentY += headingSpacing;
    }
    
    // Altura máxima disponible en la página (dejar espacio arriba del footer)
    const maxContentY = IMAGE_HEIGHT - 150; 
    
    // Altura de un item de empresa: 3 líneas de texto (Empresa, RUC, Cargo) + espacio
    const itemHeight = lineHeight * 3 + 10; 

    // Función interna para dibujar un único item de empresa
    const drawItem = (item, startX, startY, colWidth) => {
        let y = startY;
        
        // 1. Razón Social
        image.print(fontBold, startX, y, `Empresa:`); 
        // 120 es el ancho fijo del label "Empresa:"
        y = printWrappedText(image, fontData, startX + 120, y, colWidth - 120, item.razonSocial || "-", lineHeight);
        
        // 2. RUC
        image.print(fontBold, startX, y, `RUC:`); 
        y = printWrappedText(image, fontData, startX + 120, y, colWidth - 120, item.ruc || "-", lineHeight);
        
        // 3. Cargo
        image.print(fontBold, startX, y, `Cargo:`); 
        y = printWrappedText(image, fontData, startX + 120, y, colWidth - 120, item.cargo || "-", lineHeight);
        
        return y + 10; // Espacio extra entre items
    };


    if (isSplitPage) {
        // --- LÓGICA DE PÁGINA DIVIDIDA (2 COLUMNAS) ---
        
        let col1Y = currentY;
        let col2Y = currentY;
        
        // Items que caben por columna
        const itemsPerColumn = Math.floor((maxContentY - currentY) / itemHeight);
        const totalItemsPerPage = itemsPerColumn * 2;
        
        const itemsToPrint = Math.min(remainingArray.length, totalItemsPerPage);
        
        // Dividir items para las dos columnas
        const itemsCol1 = remainingArray.slice(0, Math.ceil(itemsToPrint / 2));
        const itemsCol2 = remainingArray.slice(Math.ceil(itemsToPrint / 2), itemsToPrint);

        // Imprimir Columna 1
        for (const item of itemsCol1) {
            col1Y = drawItem(item, columnLeftX, col1Y, columnWidthLeft);
        }
        
        // Imprimir Columna 2
        for (const item of itemsCol2) {
            col2Y = drawItem(item, columnRightX, col2Y, columnWidthRight);
        }

        // El final Y de la página es la mayor de las dos columnas
        const finalY = Math.max(col1Y, col2Y);
        
        return { 
            finalY: finalY, 
            remainingArray: remainingArray.slice(itemsToPrint) 
        };

    } else {
        // --- LÓGICA DE PÁGINA PRINCIPAL (1 COLUMNA IZQUIERDA) ---
        
        let printedCount = 0;
        let lastPrintedY = currentY;

        for (const item of remainingArray) {
            // Simular la impresión para verificar si cabe
            // El truco es no dibujar, solo calcular la nueva Y
            const tempImage = new Jimp(1, 1); // Imagen dummy para Jimp.measureText
            const finalItemY = drawItem(item, columnLeftX, lastPrintedY, columnWidthLeft);

            // Verificar si el elemento completo cabe en el espacio restante de la columna
            if (finalItemY > maxContentY) {
                break;
            }
            
            // Si cabe, actualizamos la Y y el contador (y dibujamos el item)
            lastPrintedY = drawItem(item, columnLeftX, lastPrintedY, columnWidthLeft);
            printedCount++;
        }
        
        // La Y final es la última Y impresa
        return { 
            finalY: lastPrintedY, 
            remainingArray: remainingArray.slice(printedCount) 
        };
    }
};

/**
 * Dibuja los elementos comunes de una página (header, footer, marcas)
 */
const drawPageCommons = async (pageImage, data, fonts, constants) => {
    const { fontTitle, fontData, MARGIN_HORIZONTAL, APP_ICON_URL, IMAGE_HEIGHT, Y_FOOTER } = constants;

    // 1. Marcas de Agua
    const marcaAgua = await generarMarcaDeAgua(pageImage); 
    pageImage.composite(marcaAgua, 0, 0); 

    // 2. Icono y Título
    try { 
        const iconBuffer = (await axios({ url: APP_ICON_URL, responseType: 'arraybuffer' })).data; 
        const mainIcon = await Jimp.read(iconBuffer); 
        mainIcon.resize(300, Jimp.AUTO); 
        const iconX = (pageImage.bitmap.width - mainIcon.bitmap.width) / 2; 
        pageImage.composite(mainIcon, iconX, 50); 
    } catch (error) { 
        console.error("Error al cargar el icono:", error); 
        pageImage.print(fontTitle, MARGIN_HORIZONTAL, 50, "Consulta Ciudadana"); 
    } 

    // 3. Footer 
    pageImage.print( 
        fontData, 
        MARGIN_HORIZONTAL, 
        Y_FOOTER, 
        "Esta imagen es solo informativa. No representa un documento oficial ni tiene validez legal." 
    ); 
};


/**
 * Función principal que genera todas las fichas paginadas.
 */
const generarFichasPaginadas = async (dni, data) => {
    const fonts = { 
        fontTitle: await Jimp.loadFont(Jimp.FONT_SANS_64_WHITE), 
        fontHeading: await Jimp.loadFont(Jimp.FONT_SANS_32_WHITE), 
        fontBold: await Jimp.loadFont(Jimp.FONT_SANS_16_WHITE), 
        fontData: await Jimp.loadFont(Jimp.FONT_SANS_16_WHITE),
    };
    
    const constants = { 
        MARGIN_HORIZONTAL, IMAGE_WIDTH, IMAGE_HEIGHT, LINE_HEIGHT, HEADING_SPACING, SEPARATOR_X, 
        Y_START_CONTENT, COLUMN_LEFT_X, COLUMN_WIDTH_LEFT, COLUMN_RIGHT_X, COLUMN_WIDTH_RIGHT,
        APP_ICON_URL, APP_QR_URL, Y_FOOTER
    };

    let images = [];
    let pageIndex = 1;
    let remainingEmpresas = data.empresas || []; // Asumiendo que 'empresas' es la clave de la lista larga

    // --- Definición de Helpers para la Página 1 (Datos Fijos) ---
    // Se definen aquí para que usen las fuentes y constantes cargadas.

    const printFieldLeft = (imagen, yPos, label, value) => { 
        const labelX = COLUMN_LEFT_X; 
        const valueX = labelX + 250; 
        const maxWidth = COLUMN_WIDTH_LEFT - (valueX - labelX); 
        imagen.print(fonts.fontBold, labelX, yPos, `${label}:`); 
        const newY = printWrappedText(imagen, fonts.fontData, valueX, yPos, maxWidth, `${value || "-"}`, LINE_HEIGHT); 
        return newY - 10; 
    }; 
    
    // Función auxiliar para imprimir imágenes de una sola columna (como la firma)
    const printImageRight = async (imagen, yPos, label, base64Image, targetWidth, targetHeight) => {
        let currentY = yPos;
        if (base64Image) {
            const bufferImage = Buffer.from(base64Image, 'base64');
            const img = await Jimp.read(bufferImage);
            img.resize(targetWidth, targetHeight); 
            const imgX = COLUMN_RIGHT_X + (COLUMN_WIDTH_RIGHT - targetWidth) / 2;
            
            imagen.print(fonts.fontHeading, COLUMN_RIGHT_X, currentY, label); 
            currentY += HEADING_SPACING; 
            
            imagen.composite(img, imgX, currentY); 
            currentY += targetHeight + HEADING_SPACING; 
        }
        return currentY;
    };

    // Función auxiliar para imprimir dos imágenes a la misma altura (huellas)
    const printDualImagesRight = async (imagen, yPos, base64ImageLeft, labelLeft, base64ImageRight, labelRight, targetWidth, targetHeight) => {
        let currentY = yPos;
        const bufferLeft = base64ImageLeft ? Buffer.from(base64ImageLeft, 'base64') : null;
        const bufferRight = base64ImageRight ? Buffer.from(base64ImageRight, 'base64') : null;
        
        if (!bufferLeft && !bufferRight) return currentY;

        const separation = 50;
        const totalWidth = targetWidth * 2 + separation;
        const startX = COLUMN_RIGHT_X + (COLUMN_WIDTH_RIGHT - totalWidth) / 2;
        const imgLeftX = startX;
        const imgRightX = startX + targetWidth + separation;

        // Imprimir etiquetas
        const labelY = currentY;
        if (bufferLeft) {
            const textWidthLeft = Jimp.measureText(fonts.fontHeading, labelLeft);
            const textXLeft = imgLeftX + (targetWidth - textWidthLeft) / 2;
            imagen.print(fonts.fontHeading, textXLeft, labelY, labelLeft);
        }
        if (bufferRight) {
            const textWidthRight = Jimp.measureText(fonts.fontHeading, labelRight);
            const textXRight = imgRightX + (targetWidth - textWidthRight) / 2;
            imagen.print(fonts.fontHeading, textXRight, labelY, labelRight);
        }
        
        currentY += HEADING_SPACING; 

        // Imprimir imágenes
        const imageY = currentY;
        if (bufferLeft) {
            const imgLeft = await Jimp.read(bufferLeft);
            imgLeft.resize(targetWidth, targetHeight);
            imagen.composite(imgLeft, imgLeftX, imageY);
        }

        if (bufferRight) {
            const imgRight = await Jimp.read(bufferRight);
            imgRight.resize(targetWidth, targetHeight);
            imagen.composite(imgRight, imgRightX, imageY);
        }

        currentY += targetHeight + HEADING_SPACING; 
        return currentY;
    };
    // --- Fin de Definición de Helpers ---

    // -------------------------------------------------------------------
    // --- 1. Generar la Página Principal (Ficha con datos fijos) ---
    // -------------------------------------------------------------------
    {
        const imagen = await new Jimp(IMAGE_WIDTH, IMAGE_HEIGHT, "#003366"); 
        await drawPageCommons(imagen, data, fonts, constants);

        let yLeft = Y_START_CONTENT; 
        let yRight = Y_START_CONTENT; 
        const separatorYEnd = IMAGE_HEIGHT - 150;

        // Línea separadora central 
        new Jimp(2, separatorYEnd - Y_START_CONTENT + 50, 0xFFFFFFFF, (err, line) => { 
            if (!err) imagen.composite(line, SEPARATOR_X, Y_START_CONTENT - 50); 
        }); 

        // Foto del ciudadano 
        if (data.imagenes?.foto) { 
            const bufferFoto = Buffer.from(data.imagenes.foto, 'base64'); 
            const foto = await Jimp.read(bufferFoto); 
            const fotoWidth = 350; 
            const fotoHeight = 400; 
            foto.resize(fotoWidth, fotoHeight); 
            const fotoX = COLUMN_RIGHT_X + (COLUMN_WIDTH_RIGHT - fotoWidth) / 2; 
            imagen.composite(foto, fotoX, Y_START_CONTENT); 
            yRight += fotoHeight + HEADING_SPACING; 
        } 
        
        // --- COLUMNA IZQUIERDA: Datos Fijos ---
        imagen.print(fonts.fontHeading, COLUMN_LEFT_X, yLeft, `Página ${pageIndex}: Datos Personales`); 
        yLeft += HEADING_SPACING; 
        
        yLeft = printFieldLeft(imagen, yLeft, "DNI", data.nuDni); 
        yLeft = printFieldLeft(imagen, yLeft, "Apellidos", `${data.apePaterno} ${data.apeMaterno} ${data.apCasada || ''}`.trim()); 
        yLeft = printFieldLeft(imagen, yLeft, "Prenombres", data.preNombres); 
        yLeft = printFieldLeft(imagen, yLeft, "Nacimiento", data.feNacimiento); 
        yLeft = printFieldLeft(imagen, yLeft, "Sexo", data.sexo); 
        yLeft = printFieldLeft(imagen, yLeft, "Estado Civil", data.estadoCivil); 
        yLeft = printFieldLeft(imagen, yLeft, "Estatura", `${data.estatura || "-"} cm`); 
        yLeft = printFieldLeft(imagen, yLeft, "Grado Inst.", data.gradoInstruccion); 
        yLeft = printFieldLeft(imagen, yLeft, "Restricción", data.deRestriccion || "NINGUNA"); 
        yLeft = printFieldLeft(imagen, yLeft, "Donación", data.donaOrganos); 
        
        yLeft += HEADING_SPACING; 
        
        imagen.print(fonts.fontHeading, COLUMN_LEFT_X, yLeft, "Información Adicional"); 
        yLeft += HEADING_SPACING; 
        
        yLeft = printFieldLeft(imagen, yLeft, "Fecha Emisión", data.feEmision); 
        yLeft = printFieldLeft(imagen, yLeft, "Fecha Inscripción", data.feInscripcion); 
        yLeft = printFieldLeft(imagen, yLeft, "Fecha Caducidad", data.feCaducidad); 
        yLeft = printFieldLeft(imagen, yLeft, "Fecha Fallecimiento", data.feFallecimiento || "-"); 
        yLeft = printFieldLeft(imagen, yLeft, "Padre", data.nomPadre); 
        yLeft = printFieldLeft(imagen, yLeft, "Madre", data.nomMadre); 
        
        yLeft += HEADING_SPACING; 
        
        imagen.print(fonts.fontHeading, COLUMN_LEFT_X, yLeft, "Datos de Dirección"); 
        yLeft += HEADING_SPACING; 
        
        yLeft = printFieldLeft(imagen, yLeft, "Dirección", data.desDireccion); 
        yLeft = printFieldLeft(imagen, yLeft, "Departamento", data.depaDireccion); 
        yLeft = printFieldLeft(imagen, yLeft, "Provincia", data.provDireccion); 
        yLeft = printFieldLeft(imagen, yLeft, "Distrito", data.distDireccion); 
        
        yLeft += HEADING_SPACING; 
        
        imagen.print(fonts.fontHeading, COLUMN_LEFT_X, yLeft, "Ubicación"); 
        yLeft += HEADING_SPACING; 
        
        yLeft = printFieldLeft(imagen, yLeft, "Ubigeo Reniec", data.ubicacion?.ubigeo_reniec); 
        yLeft = printFieldLeft(imagen, yLeft, "Ubigeo INEI", data.ubicacion?.ubigeo_inei); 
        yLeft = printFieldLeft(imagen, yLeft, "Ubigeo Sunat", data.ubicacion?.ubigeo_sunat); 
        yLeft = printFieldLeft(imagen, yLeft, "Código Postal", data.ubicacion?.codigo_postal); 
        
        // --- COLUMNA DERECHA: Firma, Huellas, QR ---
        yRight = await printImageRight(imagen, yRight, "Firma", data.imagenes?.firma, 300, 100);
        yRight = await printDualImagesRight(
            imagen, yRight, 
            data.imagenes?.huella_izquierda, "H. Izquierda", 
            data.imagenes?.huella_derecha, "H. Derecha",   
            180, 200
        );
        
        // QR al final
        try { 
            const qrCodeBuffer = await QRCode.toBuffer(constants.APP_QR_URL); 
            const qrCodeImage = await Jimp.read(qrCodeBuffer); 
            qrCodeImage.resize(250, 250); 
            const qrCodeX = COLUMN_RIGHT_X + (COLUMN_WIDTH_RIGHT - qrCodeImage.bitmap.width) / 2; 
            const qrY = Math.max(yRight, separatorYEnd - 350); 

            imagen.composite(qrCodeImage, qrCodeX, qrY); 
            imagen.print(fonts.fontHeading, qrCodeX, qrY + 260, "Escanea el QR");
        } catch (error) { 
            console.error("Error al generar el código QR:", error); 
        } 
        
        // --- COLUMNA IZQUIERDA: Sección de Empresas (Inicio, lo que quepa) ---
        let result = { finalY: yLeft, remainingArray: remainingEmpresas };

        if (remainingEmpresas.length > 0) {
            result = printArraySection(
                imagen, 
                yLeft + HEADING_SPACING, // Dejar un espacio antes de iniciar Empresas
                remainingEmpresas, 
                "Información Empresarial", 
                fonts, 
                constants,
                false // No es split page
            );
            remainingEmpresas = result.remainingArray; // Guardamos lo que queda
        }

        // Subir y guardar la primera imagen
        const imagenBuffer = await imagen.getBufferAsync(Jimp.MIME_PNG);
        images.push({ buffer: imagenBuffer, suffix: `PAGE_${pageIndex++}` });
        
        // -------------------------------------------------------------------
        // --- 2. Generar Páginas Adicionales (Contenido de Empresas) ---
        // -------------------------------------------------------------------
        
        while (remainingEmpresas.length > 0) {
            const imagenAdicional = await new Jimp(IMAGE_WIDTH, IMAGE_HEIGHT, "#003366"); 
            await drawPageCommons(imagenAdicional, data, fonts, constants);
            
            // Título de la página adicional
            imagenAdicional.print(fonts.fontTitle, MARGIN_HORIZONTAL, 150, `DNI ${data.nuDni} - Info. Empresarial (Pág. ${pageIndex})`);

            // La separación central se usa para dividir las dos columnas del contenido de empresas
            new Jimp(2, separatorYEnd - Y_START_CONTENT + 50, 0xFFFFFFFF, (err, line) => { 
                if (!err) imagenAdicional.composite(line, SEPARATOR_X, Y_START_CONTENT - 50); 
            }); 
            
            // Usamos las posiciones de las columnas izquierda y derecha para dividir el contenido
            result = printArraySection(
                imagenAdicional, 
                Y_START_CONTENT, // La página de contenido inicia más arriba (300)
                remainingEmpresas, 
                `Información Empresarial (Continuación)`, 
                fonts, 
                constants,
                true // Es split page (2 columnas)
            );
            
            remainingEmpresas = result.remainingArray;
            
            // Guardar la imagen adicional
            const bufferAdicional = await imagenAdicional.getBufferAsync(Jimp.MIME_PNG);
            images.push({ buffer: bufferAdicional, suffix: `PAGE_${pageIndex++}` });
        }
    }
    
    return images;
};


// --- RUTA MODIFICADA: Genera la ficha, incluye lógica de cache y paginación ---
app.get("/generar-ficha", async (req, res) => {
    const { dni } = req.query;
    if (!dni) return res.status(400).json({ error: "Falta el parámetro DNI" });
    
    const dateNow = new Date().toISOString();

    try { 
        // 1. 🔍 LÓGICA DE CACHE: Verificar si la imagen ya existe en GitHub
        // NOTA: Con la paginación, la lógica de caché puede volverse compleja. 
        // Se mantiene la verificación para la primera imagen, pero al tener 
        // múltiples imágenes, la generación podría ser más simple si se ignora el caché.
        // MANTENEMOS la lógica original para el caché de la PRIMERA imagen.

        const cachedUrl = await checkIfDniExists(dni);
        
        if (cachedUrl) {
            // Si la imagen existe, devolver la respuesta con un solo archivo (la primera página)
            const urlDescargaProxy = `${API_BASE_URL}/descargar-ficha?url=${encodeURIComponent(cachedUrl)}`;
            const messageText = `DNI : ${dni}\nESTADO : RESULTADO ENCONTRADO EXITOSAMENTE (Cached).`;
            
            return res.json({
                "bot": "Consulta pe",
                "chat_id": 7658983973, 
                "date": dateNow,
                "fields": { "dni": dni },
                "from_id": 7658983973, 
                "message": messageText,
                "parts_received": 1, 
                "urls": {
                    "FILE": urlDescargaProxy, 
                }
            });
        }
        
        // ----------------------------------------------------
        // 2. 🚀 LÓGICA DE GENERACIÓN (Si no existe en caché)
        // ----------------------------------------------------
        
        // Obtener datos del DNI (Consulta a la API externa)
        const response = await axios.get(`${EXTERNAL_API_URL}${dni}`); 
        const data = response.data?.result; 
        
        if (!data) return res.status(404).json({ 
            error: "No se encontró información para el DNI ingresado." 
        }); 
        
        // 3. Generación de las imágenes paginadas
        const generatedImages = await generarFichasPaginadas(dni, data);
        
        // 4. Subir todas las imágenes generadas a GitHub
        const urls = {};
        let partsReceived = 0;
        
        for (const { buffer, suffix } of generatedImages) {
            const nombreBase = `${data.nuDni}_${uuidv4()}_${suffix}`;
            const urlArchivoGitHub = await uploadToGitHub(`${nombreBase}.png`, buffer);
            
            // Usamos un índice dinámico para las URLs (FILE, FILE_1, FILE_2, ...)
            const urlKey = partsReceived === 0 ? "FILE" : `FILE_${partsReceived}`;

            urls[urlKey] = `${API_BASE_URL}/descargar-ficha?url=${encodeURIComponent(urlArchivoGitHub)}`;
            partsReceived++;

            // La primera imagen debe ser guardada con un nombre simple para que el caché la encuentre
            // La lógica de caché buscará el patrón dni_*.png, así que la primera imagen ya lo cumple.
        }

        // 5. Preparar la respuesta JSON
        const messageText = `DNI : ${data.nuDni}\nAPELLIDO PATERNO : ${data.apePaterno}\nAPELLIDO MATERNO : ${data.apeMaterno}\nNOMBRES : ${data.preNombres}\nESTADO : ${partsReceived} FICHA(S) GENERADA(S) Y GUARDADA(S) EN GITHUB (/public).`;

        res.json({
            "bot": "Consulta pe",
            "chat_id": 7658983973, 
            "date": dateNow,
            "fields": {
                "dni": data.nuDni
            },
            "from_id": 7658983973, 
            "message": messageText,
            "parts_received": partsReceived, 
            "urls": urls
        });

    } catch (error) { 
        console.error("Error general en el proceso:", error); 
        // Si el error es una falla de red (e.g., error.code === 'ENOTFOUND'), podemos devolver un mensaje específico
        const detailMessage = error.response?.data?.error || error.message || "Error desconocido en el servidor.";

        res.status(500).json({ 
            error: "Error al generar la ficha o subir a GitHub", 
            detalle: detailMessage 
        }); 
    } 

});

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


// --- RUTA: Proxy de descarga (Sin cambios) ---
app.get("/descargar-ficha", async (req, res) => {
    const { url } = req.query; 
    
    if (!url) {
        return res.status(400).send("Falta el parámetro 'url' de la imagen.");
    }

    try {
        const response = await axios.get(url, { responseType: 'arraybuffer' });
        const imageBuffer = Buffer.from(response.data);
        const urlParts = url.split('/');
        const fileName = urlParts[urlParts.length - 1]; 

        res.set({
            'Content-Disposition': `attachment; filename="${fileName}"`, 
            'Content-Type': 'image/png', 
            'Content-Length': imageBuffer.length 
        });

        res.send(imageBuffer);

    } catch (error) {
        console.error("Error al descargar o servir la imagen:", error);
        res.status(500).send("Error al procesar la descarga del archivo.");
    }
});
// --------------------------------------------------------------------------------

app.listen(PORT, HOST, () => {
    console.log(`Servidor corriendo en ${API_BASE_URL}`);
    if (!GITHUB_TOKEN) console.warn("ADVERTENCIA: GITHUB_TOKEN no está configurado.");
    if (!GITHUB_REPO) console.warn("ADVERTENCIA: GITHUB_REPO no está configurado.");
    if (!process.env.API_BASE_URL) console.warn("ADVERTENCIA: La variable de entorno API_BASE_URL no está configurada y se usa la URL de fallback: https://imagen-v2.fly.dev.");
});
