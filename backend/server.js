import express from 'express';
import Stripe from 'stripe';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import { Resend } from 'resend';
import Pedido from './models/Pedido.js';

dotenv.config();

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

// Conectar a MongoDB Atlas
console.log('🔗 Conectando a MongoDB Atlas...');
try {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ MongoDB Atlas conectado exitosamente!');
} catch (error) {
  console.error('❌ Error conectando a MongoDB:', error);
  process.exit(1);
}

// 🔥 CAMBIO CRÍTICO: Webhook PRIMERO con raw body
app.post('/api/webhook', express.raw({type: 'application/json'}), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  
  try {
    const event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      
      console.log('💰 PAGO EXITOSO RECIBIDO:');
      console.log('Session ID:', session.id);
      console.log('Email:', session.customer_details.email);
      console.log('Producto:', session.metadata.product_id);

      // Buscar pedido en MongoDB
      const pedido = await Pedido.findOne({ stripeSessionId: session.id });
      
      if (!pedido) {
        console.log('❌ Pedido no encontrado en MongoDB');
        return res.status(404).json({ error: 'Pedido no encontrado' });
      }

      // Actualizar pedido
      pedido.status = 'completed';
      pedido.clienteEmail = session.customer_details.email;
      await pedido.save();

      // Obtener datos del producto
      const producto = productos[pedido.productoId];
      
      if (!producto) {
        console.log('❌ Producto no encontrado');
        return res.status(404).json({ error: 'Producto no encontrado' });
      }

      // ENVIAR EMAIL AUTOMÁTICO
      try {
        console.log('🔍 DEBUG: Intentando enviar email con Resend...');
        console.log('🔍 DEBUG: API Key:', process.env.RESEND_API_KEY ? '✅ Existe' : '❌ No existe');
        
        const result = await resend.emails.send({
          from: 'ProdByMTR <onboarding@resend.dev>', 
          to: session.customer_details.email,
          subject: `✅ Tu compra en ProdByMTR - ${producto.nombre}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h1 style="color: #635bff;">¡Gracias por tu compra!</h1>
              
              <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <h2>📦 Detalles de tu compra:</h2>
                <p><strong>Producto:</strong> ${producto.nombre}</p>
                <p><strong>Precio:</strong> $${pedido.precioPagado} USD</p>
                <p><strong>Fecha:</strong> ${new Date().toLocaleDateString('es-ES')}</p>
              </div>

              <div style="background: #e7f3ff; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <h2>⬇️ Descarga tu producto:</h2>
                <a href="${producto.descargaUrl}" 
                   style="background: #635bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block; margin: 10px 0;"
                   target="_blank">
                   DESCARGAR AHORA - ${producto.nombre}
                </a>
                <p style="color: #666; font-size: 14px; margin-top: 10px;">
                  El enlace es válido por 30 días. Si tenés problemas, contactame.
                </p>
              </div>

              <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd;">
                <p>¿Necesitás ayuda? Contactame:</p>
                <p>📧 Email: matirodas50@gmail.com</p>
                <p>📱 WhatsApp: +595983775018</p>
              </div>
            </div>
          `
        });

        console.log('🔍 DEBUG: Respuesta de Resend:', result);
        
        // Marcar como enviado
        pedido.descargaEnviada = true;
        await pedido.save();

        console.log(`📧 Email enviado a: ${session.customer_details.email}`);
        console.log(`🎵 Producto enviado: ${producto.nombre}`);

      } catch (emailError) {
        console.error('❌ Error REAL enviando email:', emailError);
        console.error('❌ Error details:', emailError.message);
      }
    } // ← ESTA LÍNEA FALTABA - cierra el if (event.type === 'checkout.session.completed')

    res.json({ received: true });

  } catch (err) {
    console.log('❌ Error webhook:', err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
  }
});

// 🎯 MIDDLEWARE NORMAL para todas las otras rutas
app.use(cors({
  origin: ['https://prodbymtr.netlify.app', 'http://localhost:3000'],
  credentials: true
}));
app.use(express.json());

// Datos de productos (podés mover a MongoDB después)
const productos = {
  'drumkit-essential': {
    nombre: 'Drumkit Essential',
    precio: 2500, // $25.00 en centavos
    descargaUrl: 'https://drive.google.com/tu-enlace-drumkit'
  },
  'vocal-template': {
    nombre: 'Vocal Chain Template', 
    precio: 2500,
    descargaUrl: 'https://drive.google.com/tu-enlace-vocal'
  },
  'plantillas-fl': {
    nombre: 'Plantillas FL Studio',
    precio: 3500,
    descargaUrl: 'https://drive.google.com/tu-enlace-plantillas'
  },
  'bundle-completo': {
    nombre: 'Bundle Completo',
    precio: 5500, 
    descargaUrl: 'https://drive.google.com/tu-enlace-bundle'
  }
};

// 1. Endpoint para crear sesión de pago
app.post('/api/crear-pago', async (req, res) => {
  try {
    const { productId } = req.body;
    
    if (!productos[productId]) {
      return res.status(400).json({ error: 'Producto no encontrado' });
    }

    const producto = productos[productId];

    // Crear sesión en Stripe
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: producto.nombre,
              description: 'Producto digital - ProdByMTR'
            },
            unit_amount: producto.precio,
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${process.env.FRONTEND_URL}/success.html`,
      cancel_url: `${process.env.FRONTEND_URL}/`,
      metadata: {
        product_id: productId
      }
    });

    // Guardar pedido en MongoDB
    const nuevoPedido = new Pedido({
      productoId: productId,
      productoNombre: producto.nombre,
      precioPagado: producto.precio / 100,
      stripeSessionId: session.id,
      status: 'pending'
    });

    await nuevoPedido.save();
    console.log(`🛒 Pedido guardado: ${producto.nombre} - ${session.id}`);

    res.json({ 
      success: true, 
      sessionId: session.id 
    });

  } catch (error) {
    console.error('Error creando pago:', error);
    res.status(500).json({ error: error.message });
  }
});

// 3. Endpoint para ver pedidos
app.get('/api/pedidos', async (req, res) => {
  try {
    const pedidos = await Pedido.find().sort({ createdAt: -1 });
    res.json({ success: true, pedidos });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4. Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    database: mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected',
    timestamp: new Date().toISOString()
  });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
  console.log(`📊 MongoDB: ${mongoose.connection.readyState === 1 ? 'Conectado' : 'Desconectado'}`);
  console.log(`💳 Stripe: Modo ${process.env.STRIPE_SECRET_KEY.includes('test') ? 'TEST' : 'LIVE'}`);
});
