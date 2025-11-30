import mongoose from 'mongoose';

const pedidoSchema = new mongoose.Schema({
  productoId: {
    type: String,
    required: true
  },
  productoNombre: {
    type: String,
    required: true
  },
  precioPagado: {
    type: Number,
    required: true
  },
  clienteEmail: {
    type: String
  },
  stripeSessionId: {
    type: String,
    unique: true
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed'],
    default: 'pending'
  },
  descargaEnviada: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

export default mongoose.model('Pedido', pedidoSchema);