require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { connectDB, Cotizacion, Proyecto, BotMemoria, BotEstilo } = require('./services/db');

// Inicializar Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const aiModel = genAI.getGenerativeModel({ model: "gemini-3.5-flash" });

const app = express();
const PORT = process.env.PORT || 4000;

// Middlewares
app.use(cors());
app.use(express.json());

// Middleware de seguridad simple para asegurar que las peticiones vengan de tu servidor
const verifyToken = (req, res, next) => {
    const token = req.headers['x-api-token'];
    if (token === process.env.API_SECRET_TOKEN) {
        next();
    } else {
        res.status(401).json({ error: 'Acceso denegado: Token inválido' });
    }
};

// Ruta raíz
app.get('/', (req, res) => {
    res.send('Servidor del Bot de Automatización en línea 🚀');
});

// Endpoint de ejemplo: Recibir órdenes pesadas desde server_2.js
app.post('/api/bot/execute', verifyToken, (req, res) => {
    const { task, data } = req.body;
    console.log(`[BOT] Tarea recibida desde server_2.js: ${task}`);
    res.json({ status: 'success', message: `Tarea '${task}' recibida correctamente.` });
});

// ============================================================
// HUMANIZADOR: Convierte mensajes robóticos en lenguaje fluido
// Y aprende para no depender de Gemini en el futuro
// ============================================================

// --- Pools de variabilidad para el humanizador ---
const TONOS_HUMANIZADOR = [
    'muy relajado y con un toque de humor ligero',
    'directo y sin rodeos pero amigable',
    'entusiasta y motivador como si fuera buena noticia',
    'tranquilo y de confianza, como un compa de confianza',
    'eficiente pero cálido, al grano pero sin ser frío',
    'natural y espontáneo, como si lo estuvieras escribiendo tú mismo en ese momento'
];

const EXTRAS_HUMANIZADOR = [
    'usa un emoji diferente al que normalmente usarías al inicio',
    'empieza con una expresión mexicana diferente a "órale" o "sale"',
    'varía el saludo inicial, no uses siempre el mismo',
    'menciona el nombre de la persona de forma diferente al inicio',
    'añade una frase corta de aliento al final antes de la firma'
];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

app.post('/api/bot/humanize', verifyToken, async (req, res) => {
    const { texto, tipo, genero } = req.body;
    // tipo = clave del tipo de mensaje: 'tarea_encargado', 'tarea_acompanante', 'recordatorio', 'vehiculo', etc.
    // genero = 'masculino' | 'femenino'
    if (!texto || !tipo) return res.json({ humanizado: texto });

    console.log(`\n✍️  [HUMANIZADOR] Tipo: "${tipo}" | Género: "${genero || 'masculino'}" - Procesando mensaje...`);

    // Instrucción de género para el prompt
    const generoDetectado = (genero === 'femenino') ? 'femenino' : 'masculino';
    const instruccionGenero = generoDetectado === 'femenino'
        ? 'La persona que recibe este mensaje ES MUJER. Usa lenguaje femenino y expresiones apropiadas ("comadre", "échale ganas", "ya quedó", "ánimo"). EVITA expresiones masculinas como "carnal", "compa" o "mano".'
        : 'La persona que recibe este mensaje ES HOMBRE. Puedes usar expresiones como "compa", "carnal", "mano", "órale", "sale".';
    const tonoRandom  = pick(TONOS_HUMANIZADOR);
    const extraRandom = pick(EXTRAS_HUMANIZADOR);
    const horaActual  = new Date().toLocaleTimeString('es-MX', { timeZone: 'America/Mexico_City', hour: '2-digit', minute: '2-digit' });

    // ====================================================
    // PASO 1: ¿Ya aprendimos cómo humanizar este tipo?
    //         Si sí, usamos la regla aprendida PERO le
    //         inyectamos variabilidad para que no repita.
    // ====================================================
    try {
        const estiloAprendido = await BotEstilo.findOne({ tipo });
        if (estiloAprendido && estiloAprendido.instruccionAprendida) {
            console.log(`🎓 [APRENDIDO] Tengo el patrón para "${tipo}". Aplicando variabilidad...`);

            // Obtener últimas frases usadas para evitar repetición
            const ultimasFrases = estiloAprendido.ultimasFrases || [];
            const antiRepeticion = ultimasFrases.length > 0
                ? `\n\n🚫 PROHIBIDO: No uses ninguna de estas frases de inicio que ya usaste antes: [${ultimasFrases.join(' | ')}]. Sé creativo y diferente.`
                : '';

            // Prompt enriquecido con variabilidad controlada Y género
            const promptVariado = `${estiloAprendido.instruccionAprendida}

🚻 GÉNERO DEL DESTINATARIO: ${instruccionGenero}

🎨 VARIACIÓN OBLIGATORIA PARA ESTA ENTREGA:
- Tono esta vez: ${tonoRandom}
- Variación extra: ${extraRandom}
- La hora actual en México es: ${horaActual} (adáptate si aplica, ej: si es noche saluda diferente)${antiRepeticion}

Transforma este mensaje con esa variación aplicada, manteniendo todos los datos importantes:
"${texto}"`;

            const result = await aiModel.generateContent(promptVariado);
            const textoHumanizado = result.response.text();

            // Extraer frase de inicio del resultado para el mini-historial anti-repetición
            const primeraLinea = textoHumanizado.split('\n')[0].substring(0, 60).trim();
            const nuevasFrases = [primeraLinea, ...ultimasFrases].slice(0, 4); // guardar últimas 4

            await BotEstilo.updateOne(
                { tipo },
                { $inc: { vecesUsado: 1 }, ultimasFrases: nuevasFrases }
            );

            console.log(`🎨 [VARIABILIDAD] Tono: "${tonoRandom}" | Extra: "${extraRandom}"`);
            return res.json({ humanizado: textoHumanizado, fuenteAprendida: true });
        }
    } catch (err) {
        console.error('⚠️ Error buscando estilo aprendido:', err.message);
    }

    // ====================================================
    // PASO 2: Primera vez - Gemini aprende el patrón
    // ====================================================
    console.log(`🧠 [GEMINI] Aprendiendo cómo humanizar tipo "${tipo}" por primera vez...`);
    try {
        const personalidad = `Eres el asistente del sistema Naisata CRM. Hablas relajado y natural, como alguien del barrio (nivel 7/10) pero sin groserías. Tuteas siempre. Usas expresiones mexicanas como "ya checé", "órale", "¡sale!", "compa", "ya quedó". Eres directo y amigable. Conservas todos los datos importantes (fechas, nombres, horas, proyectos) pero con lenguaje humano y cálido.`;

        const promptAprendizaje = `${personalidad}\n\n🚻 GÉNERO DEL DESTINATARIO: ${instruccionGenero}\n\nTransforma este mensaje automático a un mensaje WhatsApp más humano y natural (máximo 400 caracteres). ES CRÍTICO Y OBLIGATORIO: 1) El saludo o frase introductoria (el encabezado) debe ser muy corto, de MÁXIMO 20 PALABRAS. 2) Usar saltos de línea con \\n para separar las ideas. 3) Mantener intactos los listados separando claramente en líneas distintas a los acompañantes, vehículos y proyectos, nunca los juntes en un solo párrafo. 4) Si el mensaje original contiene opciones como "ACEPTAR" / "RECHAZAR", mantenlas intactas al final. Si el mensaje original NO las contiene, NO las agregues por ningún motivo:\n\n"${texto}"\n\nAdemás, al final de tu respuesta escribe en una nueva línea que empiece exactamente con "REGLA:" una instrucción de cómo deberías transformar mensajes de este tipo en el futuro, recordando siempre separar la información de listas y personas en múltiples renglones.`;

        const result = await aiModel.generateContent(promptAprendizaje);
        const respuestaCompleta = result.response.text();

        // Separar el mensaje humanizado de la regla aprendida
        const partes = respuestaCompleta.split('REGLA:');
        const textoHumanizado = partes[0].trim();
        const reglaAprendida = partes[1] ? partes[1].trim() : null;

        // Guardar la regla en MongoDB para el futuro
        if (reglaAprendida) {
            const instruccion = `${personalidad}\n\nREGLA APRENDIDA PARA MENSAJES DE TIPO "${tipo}": ${reglaAprendida}`;
            await BotEstilo.findOneAndUpdate(
                { tipo },
                {
                    tipo,
                    ejemploOriginal: texto.substring(0, 300),
                    ejemploHumanizado: textoHumanizado.substring(0, 300),
                    instruccionAprendida: instruccion,
                    vecesUsado: 1
                },
                { upsert: true, returnDocument: 'after' }
            );
            console.log(`💾 [APRENDIZAJE] Regla guardada para tipo "${tipo}". ¡Ya no necesitaré aprender esto de nuevo!`);
        }

        return res.json({ humanizado: textoHumanizado, reglaAprendida: reglaAprendida || null });

    } catch (error) {
        console.error('❌ Error en Humanizador:', error.message);
        // Si falla Gemini, devolvemos el texto original sin cambios
        return res.json({ humanizado: texto, error: error.message });
    }
});
// ============================================================

// ==========================================
// CEREBRO: Analizador de mensajes entrantes
// ==========================================
app.post('/api/bot/analyze', verifyToken, async (req, res) => {
    const { from, body, isGroup } = req.body;
    const mensaje = body ? body.trim() : '';

    console.log(`\n\ud83e\udde0 [CEREBRO] Analizando mensaje de ${from}: "${mensaje}"`);

    if (!mensaje.toLowerCase().startsWith('bot ')) {
        console.log('\u23ed\ufe0f No es mensaje de IA. Pasando el control al bot viejo...');
        return res.json({ handled: false });
    }

    const mensajeLimpio = mensaje.substring(4).trim();
    // Clave normalizada para la memoria (sin acentos, minúsculas, sin espacios extras)
    const claveMemoria = mensajeLimpio.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

    // ================================================
    // PASO 1: ¿Ya sé la respuesta? Buscar en MEMORIA
    // ================================================
    // Solo usamos memoria para preguntas genéricas (no de folios específicos)
    const esPreguntaGenerica = !/\b(c|p)\d+\b/i.test(mensajeLimpio);
    if (esPreguntaGenerica) {
        try {
            const recuerdo = await BotMemoria.findOne({ clave: claveMemoria });
            if (recuerdo) {
                console.log(`\ud83d\udcad [MEMORIA] Respuesta encontrada (usada ${recuerdo.vecesUsada} veces). Sin llamar a Gemini.`);
                await BotMemoria.updateOne({ clave: claveMemoria }, { $inc: { vecesUsada: 1 }, fechaUltimoUso: new Date() });
                return res.json({ handled: true, reply: recuerdo.respuesta });
            }
        } catch (memErr) {
            console.error('\u26a0\ufe0f Error consultando memoria:', memErr.message);
        }
    }

    // ================================================
    // PASO 2: Llamar a Gemini con personalidad 7/10
    // ================================================
    console.log('\u2705 Activando Inteligencia Artificial (Gemini)...');
    const herramientasGemini = [{
        functionDeclarations: [
            {
                name: "consultarCotizacion",
                description: "Busca una cotizaci\u00f3n por su folio (ej. C15) para decirle al cliente su estado actual.",
                parameters: {
                    type: "OBJECT",
                    properties: {
                        folio: { type: "STRING", description: "El n\u00famero de folio exacto de la cotizaci\u00f3n, ej: C15" }
                    },
                    required: ["folio"]
                }
            },
            {
                name: "consultarProyecto",
                description: "Busca un proyecto por su folio (ej. P20) o nombre para saber su progreso.",
                parameters: {
                    type: "OBJECT",
                    properties: {
                        folio: { type: "STRING", description: "El folio del proyecto" },
                        nombre: { type: "STRING", description: "El nombre del proyecto" }
                    }
                }
            }
        ]
    }];

    try {
        const chat = aiModel.startChat({ tools: herramientasGemini });

        // PERSONALIDAD 7/10 DE BARRIO
        const personalidad = `Eres el asistente del sistema Naisata CRM. Tu forma de hablar es relajada y natural, como alguien del barrio pero sin groserías ni albures. Tuteas al cliente. Usas expresiones como "ya checé", "\u00f3rale", "compa", "\u00a1sale!", "ya quedó". Eres directo, amigable y eficiente. Cuando hay datos concretos (precios, estados, fechas) los dices claramente aunque hables relajado. No eres robot corporativo, eres el compa que sabe del sistema.`;

        const promptContext = `${personalidad}\n\nUn cliente te escribi\u00f3: "${mensajeLimpio}". Si pregunta por una cotizaci\u00f3n o proyecto usa tus herramientas para buscar en la base de datos real y responde con los datos. Si no encuentras algo, d\u00edselo natural.`;

        let result = await chat.sendMessage(promptContext);

        // ¿Gemini quiere buscar en BD?
        if (result.response.functionCalls && result.response.functionCalls().length > 0) {
            const call = result.response.functionCalls()[0];
            let apiResponse = {};

            if (call.name === 'consultarCotizacion') {
                console.log(`\ud83d\udd0d Gemini busca cotizaci\u00f3n: ${call.args.folio}`);
                const cot = await Cotizacion.findOne({ folio: call.args.folio.toUpperCase() });
                apiResponse = cot
                    ? { encontrada: true, estado: cot.estado, total: cot.total, cliente: cot.clienteNombre, descripcion: cot.descripcion }
                    : { encontrada: false, mensaje: 'Cotizaci\u00f3n no existe' };
            } else if (call.name === 'consultarProyecto') {
                console.log(`\ud83d\udd0d Gemini busca proyecto:`, call.args);
                const filtro = call.args.folio
                    ? { folio: call.args.folio.toUpperCase() }
                    : { nombre: { $regex: call.args.nombre, $options: 'i' } };
                const proy = await Proyecto.findOne(filtro);
                apiResponse = proy
                    ? { encontrada: true, nombre: proy.nombre, estado: proy.estado, avance: proy.porcentajeAvance + '%', cliente: proy.clienteNombre }
                    : { encontrada: false, mensaje: 'Proyecto no existe' };
            }

            console.log(`\ud83d\udcca BD \u2192 Gemini:`, apiResponse);
            result = await chat.sendMessage([{ functionResponse: { name: call.name, response: apiResponse } }]);
        }

        const respuestaFluida = result.response.text();

        // ================================================
        // PASO 3: GUARDAR en MEMORIA si es pregunta gen\u00e9rica
        // ================================================
        if (esPreguntaGenerica && respuestaFluida) {
            try {
                await BotMemoria.findOneAndUpdate(
                    { clave: claveMemoria },
                    { clave: claveMemoria, respuesta: respuestaFluida, fechaUltimoUso: new Date() },
                    { upsert: true, returnDocument: 'after' }
                );
                console.log(`\ud83d\udcbe [MEMORIA] Nueva respuesta guardada para futuros usos.`);
            } catch (saveErr) {
                // No es cr\u00edtico si no se puede guardar
            }
        }

        return res.json({ handled: true, reply: respuestaFluida });

    } catch (error) {
        console.error('\u274c Error con Gemini:', error.message);
        return res.json({ handled: false, error: error.message });
    }
});
// ==========================================

// Ejemplo: Función para que el bot le hable a server_2.js
const notificarServer2 = async (mensaje) => {
    try {
        const url = `${process.env.SERVER_2_URL}/api/bridge/receive`;
        console.log(`[BOT] Notificando a server_2.js en ${url}...`);
        
        const response = await axios.post(url, { 
            status: 'online',
            mensaje: mensaje,
            timestamp: new Date()
        }, {
            headers: { 'x-api-token': process.env.API_SECRET_TOKEN }
        });
        console.log('[BOT] Respuesta de server_2.js recibida con éxito:', response.data);
    } catch (error) {
        console.error('[BOT] Error de conexión con server_2.js:', error.message);
    }
};

app.listen(PORT, '0.0.0.0', () => {
    // Conectar a Mongo al iniciar
    connectDB();

    console.log(`=================================================`);
    console.log(`🤖 Servidor de Bot Avanzado corriendo en el puerto ${PORT}`);
    console.log(`=================================================`);
    
    // Probar el puente de comunicación 2 segundos después de arrancar
    setTimeout(() => {
        notificarServer2('¡Hola CRM! El Bot Avanzado acaba de despertar y ya tiene acceso a la Base de Datos.');
    }, 2000);
});
