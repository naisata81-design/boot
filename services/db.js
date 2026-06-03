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

module.exports = { connectDB, Cotizacion, Proyecto };
