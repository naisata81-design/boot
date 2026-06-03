require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { connectDB, Cotizacion, Proyecto } = require('./services/db');

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
    
    // Aquí implementaremos las automatizaciones pesadas o flujos de WhatsApp
    // ...

    res.json({ status: 'success', message: `Tarea '${task}' recibida correctamente.` });
});

// ==========================================
// CEREBRO: Analizador de mensajes entrantes
// ==========================================
app.post('/api/bot/analyze', verifyToken, async (req, res) => {
    const { from, body, isGroup } = req.body;
    const mensaje = body ? body.trim() : '';

    console.log(`\n🧠 [CEREBRO] Analizando mensaje de ${from}: "${mensaje}"`);

    // Definimos las Herramientas (Tools) que Gemini puede usar
    const herramientasGemini = [{
        functionDeclarations: [
            {
                name: "consultarCotizacion",
                description: "Busca una cotización por su folio (ej. C15) para decirle al cliente su estado actual.",
                parameters: {
                    type: "OBJECT",
                    properties: {
                        folio: { type: "STRING", description: "El número de folio exacto de la cotización, ej: C15" }
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

    // --- INTEGRACIÓN CON GEMINI ---
    if (mensaje.toLowerCase().startsWith('bot ')) {
        console.log('✅ Activando Inteligencia Artificial (Gemini) con acceso a Base de Datos...');
        try {
            // Iniciamos un chat y le pasamos las herramientas
            const chat = aiModel.startChat({ tools: herramientasGemini });
            
            const promptContext = `Eres un asistente inteligente, amable y servicial del sistema Naisata CRM. Un cliente te ha escrito: "${mensaje.substring(4)}". Si te preguntan por una cotización o proyecto, usa tus herramientas obligatoriamente para buscar en la base de datos real y da una respuesta natural en español con los datos. Si no lo encuentras, dilo amablemente.`;
            
            let result = await chat.sendMessage(promptContext);
            
            // ¿Gemini pidió buscar en la base de datos?
            if (result.response.functionCalls && result.response.functionCalls().length > 0) {
                const call = result.response.functionCalls()[0];
                let apiResponse = {};
                
                if (call.name === 'consultarCotizacion') {
                    console.log(`🔍 Gemini solicitó buscar cotización: ${call.args.folio}`);
                    const cot = await Cotizacion.findOne({ folio: call.args.folio.toUpperCase() });
                    apiResponse = cot ? { encontrada: true, estado: cot.estado, total: cot.total, cliente: cot.clienteNombre } : { encontrada: false, mensaje: "Cotización no existe" };
                } 
                else if (call.name === 'consultarProyecto') {
                    console.log(`🔍 Gemini solicitó buscar proyecto:`, call.args);
                    const filtro = call.args.folio ? { folio: call.args.folio.toUpperCase() } : { nombre: { $regex: call.args.nombre, $options: 'i' } };
                    const proy = await Proyecto.findOne(filtro);
                    apiResponse = proy ? { encontrada: true, nombre: proy.nombre, estado: proy.estado, avance: proy.porcentajeAvance + '%' } : { encontrada: false, mensaje: "Proyecto no existe" };
                }

                console.log(`📊 Resultado de la BD entregado a Gemini:`, apiResponse);
                // Le pasamos el resultado a Gemini para que él redacte la respuesta final
                result = await chat.sendMessage([{
                    functionResponse: {
                        name: call.name,
                        response: apiResponse
                    }
                }]);
            }
            
            const respuestaFluida = result.response.text();
            
            return res.json({ 
                handled: true, 
                reply: respuestaFluida 
            });
        } catch (error) {
            console.error('❌ Error comunicándose con Gemini:', error.message);
            return res.json({ handled: false, error: error.message });
        }
    }

    // Si el mensaje no dice "bot ", pasamos la estafeta
    console.log('⏭️ No es mensaje de IA. Pasando el control al bot viejo...');
    return res.json({ handled: false });
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

app.listen(PORT, () => {
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
