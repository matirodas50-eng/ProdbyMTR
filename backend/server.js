import express from 'express';
import Stripe from 'stripe';
import cors from 'cors';
import dotenv from 'dotenv';
import Mailjet from 'node-mailjet';
import pg from 'pg';
const { Pool } = pg;

dotenv.config();

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const mailjet = Mailjet.apiConnect(
  process.env.MAILJET_API_KEY,
  process.env.MAILJET_SECRET_KEY
);

// ✅ CONEXIÓN A POSTGRESQL (NEON) - NO MONGODB
console.log('🔗 Conectando a Neon PostgreSQL...');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true }
});

// Verificar conexión PostgreSQL
(async () => {
  try {
    await pool.query('SELECT NOW()');
    console.log('✅ PostgreSQL (Neon) conectado!');
  } catch (error) {
    console.error('❌ Error conectando a PostgreSQL:', error);
    process.exit(1);
  }
})();

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

      // ✅ BUSCAR PEDIDO EN POSTGRESQL (NO MONGODB)
      const pedidoResult = await pool.query(
        'SELECT * FROM pedidos WHERE stripe_session_id = $1',
        [session.id]
      );
      
      if (!pedidoResult.rows[0]) {
        console.log('❌ Pedido no encontrado en PostgreSQL');
        return res.status(404).json({ error: 'Pedido no encontrado' });
      }

      const pedido = pedidoResult.rows[0];

      // ✅ ACTUALIZAR PEDIDO EN POSTGRESQL
      await pool.query(`
        UPDATE pedidos 
        SET status = 'completed', 
            cliente_email = $1,
            descarga_enviada = true,
            actualizado_en = NOW()
        WHERE stripe_session_id = $2
      `, [session.customer_details.email, session.id]);

      // Obtener datos del producto
      const producto = productos[pedido.producto_id];
      
      if (!producto) {
        console.log('❌ Producto no encontrado');
        return res.status(404).json({ error: 'Producto no encontrado' });
      }

      // ENVIAR EMAIL AUTOMÁTICO
      try {
        console.log('🔍 DEBUG: Intentando enviar email con Mailjet...');
        
        // 1. Email al CLIENTE
        const resultCliente = await mailjet.post('send', { version: 'v3.1' }).request({
          Messages: [{
            From: { Email: 'matirodas50@gmail.com', Name: 'ProdByMTR' },
            To: [{ Email: session.customer_details.email }],
            Subject: `✅ Tu compra en ProdByMTR - ${producto.nombre}`,
            HTMLPart: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <!-- ANTISPAM -->
                <meta name="format-detection" content="telephone=no">
                <meta name="format-detection" content="date=no">
                <meta name="format-detection" content="address=no">
                <meta name="format-detection" content="email=no">
                <div style="display:none;font-size:0px;line-height:0px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">
                  ${producto.nombre} - ProdByMTR - ${new Date().getFullYear()}
                </div>
                <!-- FIN ANTISPAM -->
                
                <h1 style="color: #635bff;">¡Gracias por tu compra!</h1>
                
                <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
                  <h2>📦 Detalles de tu compra:</h2>
                  <p><strong>Producto:</strong> ${producto.nombre}</p>
                  <p><strong>Precio:</strong> $${pedido.precio_pagado} USD</p>
                  <p><strong>Fecha:</strong> ${new Date().toLocaleDateString('es-ES', {timeZone: 'America/Asuncion'})}</p>
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
          }]
        });

        // 2. Email SIMPLE a VOS
        const resultTuCopia = await mailjet.post('send', { version: 'v3.1' }).request({
          Messages: [{
            From: { Email: 'matirodas50@gmail.com', Name: 'ProdByMTR' },
            To: [{ Email: 'matirodas50@gmail.com' }],
            Subject: `🛒 NUEVA VENTA - ${producto.nombre}`,
            HTMLPart: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <!-- ANTISPAM -->
                <meta name="format-detection" content="telephone=no">
                <meta name="format-detection" content="date=no">
                <meta name="format-detection" content="address=no">
                <meta name="format-detection" content="email=no">
                <div style="display:none;font-size:0px;line-height:0px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">
                  ${producto.nombre} - ProdByMTR - ${new Date().getFullYear()}
                </div>
                <!-- FIN ANTISPAM -->
                
                <h2>🛒 NUEVA VENTA - ${producto.nombre}</h2>
                
                <div style="background: #f8f9fa; padding: 15px; border-radius: 6px; margin: 15px 0;">
                  <p><strong>Producto:</strong> ${producto.nombre}</p>
                  <p><strong>Precio:</strong> $${pedido.precio_pagado} USD</p>
                  <p><strong>Cliente:</strong> ${session.customer_details.email}</p>
                  <p><strong>Fecha:</strong> ${new Date().toLocaleDateString('es-ES', {timeZone: 'America/Asuncion'})}</p>
                  <p><strong>Hora:</strong> ${new Date().toLocaleTimeString('es-ES', {timeZone: 'America/Asuncion'})}</p>
                </div>
              </div>
            `
          }]
        });

        console.log('🔍 DEBUG: Email al cliente:', resultCliente.body);
        console.log('🔍 DEBUG: Email a vos:', resultTuCopia.body);
        
        console.log(`📧 Email enviado a cliente: ${session.customer_details.email}`);
        console.log(`📧 Email enviado a vos: matirodas50@gmail.com`);

      } catch (emailError) {
        console.error('❌ Error enviando email:', emailError);
      }
    }

    res.json({ received: true });

  } catch (err) {
    console.log('❌ Error webhook:', err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
  }
});

// 🎯 MIDDLEWARE NORMAL para todas las otras rutas
app.use(cors({
  origin: [ 'https://matirodas50-eng.github.io', 'http://localhost:3000'],
  credentials: true
}));
app.use(express.json());

// Datos de productos
const productos = {
  'drumkit-essential': {
    nombre: 'Drumkit Essential',
    precio: 2500,
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

// 1. Endpoint para crear sesión de pago (POSTGRESQL)
app.post('/api/crear-pago', async (req, res) => {
  try {
    const { productId } = req.body;
    
    if (!productos[productId]) {
      return res.status(400).json({ error: 'Producto no encontrado' });
    }

    const producto = productos[productId];

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

    // ✅ GUARDAR EN POSTGRESQL (NO MONGODB)
    await pool.query(`
      INSERT INTO pedidos 
      (producto_id, producto_nombre, precio_pagado, stripe_session_id, status)
      VALUES ($1, $2, $3, $4, 'pending')
    `, [
      productId,
      producto.nombre,
      producto.precio / 100,  // Convertir centavos a dólares
      session.id
    ]);

    console.log(`🛒 Pedido guardado en PostgreSQL: ${producto.nombre} - ${session.id}`);

    res.json({ 
      success: true, 
      sessionId: session.id 
    });

  } catch (error) {
    console.error('Error creando pago:', error);
    res.status(500).json({ error: error.message });
  }
});

// 3. Endpoint para ver pedidos (POSTGRESQL)
app.get('/api/pedidos', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM pedidos 
      ORDER BY creado_en DESC
    `);
    res.json({ success: true, pedidos: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4. Health check (POSTGRESQL)
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ 
      status: 'OK', 
      database: 'PostgreSQL (Neon) Connected',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ 
      status: 'ERROR', 
      database: 'PostgreSQL Disconnected',
      error: error.message 
    });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
  console.log(`💳 Stripe: Modo ${process.env.STRIPE_SECRET_KEY.includes('test') ? 'TEST' : 'LIVE'}`);
  console.log(`🗄️  Base de datos: PostgreSQL (Neon)`);
});
