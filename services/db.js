const mongoose = require('mongoose');

const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI, {
            serverSelectionTimeoutMS: 15000,
        });
        console.log('✅ Cerebro conectado a la Base de Datos (MongoDB)');
    } catch (err) {
        console.error('❌ Error del Cerebro al conectar a MongoDB:', err.message);
    }
};

// Definimos solo los campos que el Bot necesita leer (modo lectura)
const CRMCotizacionSchema = new mongoose.Schema({
    folio: String,
    clienteNombre: String,
    descripcion: String,
    estado: String,
    total: Number,
    fechaCreacion: Date
});
const Cotizacion = mongoose.model('CRMCotizacion', CRMCotizacionSchema);

const CRMProyectoSchema = new mongoose.Schema({
    folio: String,
    nombre: String,
    clienteNombre: String,
    estado: String,
    porcentajeAvance: Number,
    fechaInicio: Date
});
const Proyecto = mongoose.model('CRMProyecto', CRMProyectoSchema);

// Memoria del Bot: guarda preguntas frecuentes y sus respuestas aprendidas
const BotMemoriaSchema = new mongoose.Schema({
    clave: { type: String, unique: true },      // Texto normalizado de la pregunta
    respuesta: String,                           // Respuesta que Gemini generó antes
    vecesUsada: { type: Number, default: 1 },   // Cuántas veces se ha reutilizado
    fechaAprendizaje: { type: Date, default: Date.now },
    fechaUltimoUso: { type: Date, default: Date.now }
});
const BotMemoria = mongoose.model('BotMemoria', BotMemoriaSchema);

// Estilos Aprendidos: guarda cómo humanizar mensajes por tipo
// El bot aprende el patrón y deja de depender de Gemini
const BotEstiloSchema = new mongoose.Schema({
    tipo: { type: String, unique: true }, // ej: 'tarea_encargado', 'recordatorio', 'vehiculo'
    ejemploOriginal: String,              // Texto robótico de ejemplo
    ejemploHumanizado: String,            // Cómo lo transformó Gemini
    instruccionAprendida: String,         // Reglas que el bot extrae para replicarlo solo
    vecesUsado: { type: Number, default: 0 },
    ultimasFrases: { type: [String], default: [] }, // Mini-historial de frases de inicio usadas (máx 4)
    fechaAprendizaje: { type: Date, default: Date.now }
});
const BotEstilo = mongoose.model('BotEstilo', BotEstiloSchema);

module.exports = { connectDB, Cotizacion, Proyecto, BotMemoria, BotEstilo };
