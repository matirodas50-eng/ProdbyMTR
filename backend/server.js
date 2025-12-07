import express from 'express';
import Stripe from 'stripe';
import cors from 'cors';
import dotenv from 'dotenv';
import Mailjet from 'node-mailjet';
import pg from 'pg';
const { Pool } = pg;

dotenv.config();

// ==================== CONFIGURACIÓN INICIAL ====================
const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const mailjet = Mailjet.apiConnect(
  process.env.MAILJET_API_KEY,
  process.env.MAILJET_SECRET_KEY
);

console.log('🚀 Iniciando servidor ProdByMTR...');
console.log('🔗 Conectando a Neon PostgreSQL...');

// Configuración optimizada para Neon
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  max: 10
});

// Verificar conexión PostgreSQL
(async () => {
  try {
    const client = await pool.connect();
    await client.query('SELECT NOW()');
    client.release();
    console.log('✅ PostgreSQL (Neon) conectado!');
  } catch (error) {
    console.error('❌ Error conectando a PostgreSQL:', error.message);
    console.log('⚠️  Continuando sin base de datos (solo modo prueba)...');
  }
})();

// ==================== WEBHOOK ====================
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

      try {
        const pedidoResult = await pool.query(
          'SELECT * FROM pedidos WHERE stripe_session_id = $1',
          [session.id]
        );
        
        if (!pedidoResult.rows[0]) {
          console.log('❌ Pedido no encontrado en PostgreSQL');
          return res.status(404).json({ error: 'Pedido no encontrado' });
        }

        const pedido = pedidoResult.rows[0];

        await pool.query(`
          UPDATE pedidos 
          SET status = 'completed', 
              cliente_email = $1,
              descarga_enviada = true,
              actualizado_en = NOW()
          WHERE stripe_session_id = $2
        `, [session.customer_details.email, session.id]);

        const producto = productos[pedido.producto_id];
        
        if (!producto) {
          console.log('❌ Producto no encontrado');
          return res.status(404).json({ error: 'Producto no encontrado' });
        }

        // ENVIAR EMAIL AL CLIENTE
        await mailjet.post('send', { version: 'v3.1' }).request({
          Messages: [{
            From: { Email: 'matirodas50@gmail.com', Name: 'ProdByMTR' },
            To: [{ Email: session.customer_details.email }],
            Subject: `✅ Tu compra en ProdByMTR - ${producto.nombre}`,
            HTMLPart: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
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

        // EMAIL A VOS
        await mailjet.post('send', { version: 'v3.1' }).request({
          Messages: [{
            From: { Email: 'matirodas50@gmail.com', Name: 'ProdByMTR' },
            To: [{ Email: 'matirodas50@gmail.com' }],
            Subject: `🛒 NUEVA VENTA - ${producto.nombre}`,
            HTMLPart: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2>🛒 NUEVA VENTA - ${producto.nombre}</h2>
                <div style="background: #f8f9fa; padding: 15px; border-radius: 6px; margin: 15px 0;">
                  <p><strong>Producto:</strong> ${producto.nombre}</p>
                  <p><strong>Precio:</strong> $${pedido.precio_pagado} USD</p>
                  <p><strong>Cliente:</strong> ${session.customer_details.email}</p>
                  <p><strong>Fecha:</strong> ${new Date().toLocaleDateString('es-ES', {timeZone: 'America/Asuncion'})}</p>
                </div>
              </div>
            `
          }]
        });

        console.log(`✅ Email enviado a: ${session.customer_details.email}`);

      } catch (dbError) {
        console.error('❌ Error procesando pedido:', dbError.message);
      }
    }

    res.json({ received: true });

  } catch (err) {
    console.log('❌ Error webhook:', err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
  }
});

// ==================== MIDDLEWARE ====================
app.use(cors({
  origin: ['https://matirodas50-eng.github.io', 'http://localhost:3000'],
  credentials: true
}));
app.use(express.json());

// ==================== DATOS DE 9 PRODUCTOS ====================
const productos = {
  'drumkit-essential': {
    nombre: 'DRUMKIT ESSENTIAL',
    precio: 2500, // $25 USD
    descargaUrl: 'https://drive.google.com/tu-enlace-drumkit'
  },
  'vocal-template': {
    nombre: 'VOCAL CHAIN TEMPLATE', 
    precio: 1700, // $17 USD
    descargaUrl: 'https://drive.google.com/tu-enlace-vocal'
  },
  'plantillas-fl': {
    nombre: 'PLANTILLAS FL STUDIO',
    precio: 2900, // $29 USD
    descargaUrl: 'https://drive.google.com/tu-enlace-plantillas'
  },
  'cumbia-420': {
    nombre: 'CUMBIA 420 - DRUMKIT',
    precio: 1800, // $18 USD
    descargaUrl: 'https://drive.google.com/tu-enlace-cumbia'
  },
  'reggaeton-hits': {
    nombre: 'REGGAETON HITS - DRUMKIT',
    precio: 2000, // $20 USD
    descargaUrl: 'https://drive.google.com/tu-enlace-reggaeton'
  },
  'trap-essentials': {
    nombre: 'TRAP ESSENTIALS - PACK',
    precio: 2200, // $22 USD
    descargaUrl: 'https://drive.google.com/tu-enlace-trap'
  },
  'synthwave-pop': {
    nombre: 'SYNTHWAVE & POP - PACK',
    precio: 2500, // $25 USD
    descargaUrl: 'https://drive.google.com/tu-enlace-synthwave'
  },
  'bundle-generos': {
    nombre: 'BUNDLE DE GÉNEROS',
    precio: 6500, // $65 USD
    descargaUrl: 'https://drive.google.com/tu-enlace-bundle-generos'
  },
  'bundle-completo': {
    nombre: 'BUNDLE COMPLETO',
    precio: 9900, // $99 USD
    descargaUrl: 'https://drive.google.com/tu-enlace-bundle-completo'
  }
};

// ==================== ENDPOINTS ====================

// 1. Health Check
app.get('/api/health', async (req, res) => {
  res.json({ 
    status: 'OK',
    service: 'ProdByMTR Backend',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// 2. Warm-up endpoint
app.get('/api/warmup', (req, res) => {
  console.log('🔥 Servidor calentado por petición');
  res.json({ warmed: true, time: new Date().toISOString() });
});

// 3. Endpoint para crear pago
app.post('/api/crear-pago', async (req, res) => {
  console.log('🛒 Recibiendo solicitud de pago...');
  
  req.setTimeout(25000);
  
  try {
    const { productId } = req.body;
    
    if (!productos[productId]) {
      return res.status(400).json({ 
        success: false, 
        error: 'Producto no encontrado' 
      });
    }

    const producto = productos[productId];

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: producto.nombre,
            description: 'Producto digital - ProdByMTR'
          },
          unit_amount: producto.precio,
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${process.env.FRONTEND_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/?canceled=true`,
      metadata: { product_id: productId },
      expires_at: Math.floor(Date.now() / 1000) + 1800
    });

    // Guardar en PostgreSQL
    try {
      await pool.query(`
        INSERT INTO pedidos 
        (producto_id, producto_nombre, precio_pagado, stripe_session_id, status)
        VALUES ($1, $2, $3, $4, 'pending')
      `, [
        productId,
        producto.nombre,
        producto.precio / 100,
        session.id
      ]);
      console.log(`✅ Pedido guardado en PostgreSQL: ${session.id}`);
    } catch (dbError) {
      console.warn('⚠️  Pedido NO guardado en DB (modo offline):', dbError.message);
    }

    console.log(`✅ Sesión Stripe creada: ${session.id}`);
    
    res.json({ 
      success: true, 
      sessionId: session.id,
      message: 'Redirigiendo a Stripe...'
    });

  } catch (error) {
    console.error('❌ Error creando pago:', error.message);
    
    let statusCode = 500;
    let errorMessage = error.message;
    let userMessage = 'Error inesperado. Por favor, intentá de nuevo.';
    
    if (error.type === 'StripeConnectionError') {
      statusCode = 503;
      userMessage = 'Stripe no responde. Intentá en unos minutos.';
    } else if (error.code === 'ECONNREFUSED') {
      statusCode = 503;
      userMessage = 'Servidor iniciando. Esperá 30 segundos e intentá de nuevo.';
    }
    
    res.status(statusCode).json({ 
      success: false, 
      error: errorMessage,
      message: userMessage
    });
  }
});

// 4. Verificar estado de sesión
app.get('/api/verificar-sesion/:sessionId', async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.retrieve(req.params.sessionId);
    res.json({ 
      status: session.payment_status,
      email: session.customer_details?.email,
      completed: session.payment_status === 'paid'
    });
  } catch (error) {
    res.status(404).json({ error: 'Sesión no encontrada' });
  }
});

// 5. Ver pedidos
app.get('/api/pedidos', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM pedidos 
      ORDER BY creado_en DESC
      LIMIT 50
    `);
    res.json({ success: true, pedidos: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== INICIAR SERVIDOR ====================
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
  console.log(`💳 Stripe: ${process.env.STRIPE_SECRET_KEY?.includes('test') ? 'MODO TEST' : 'MODO LIVE'}`);
  console.log(`🌍 Frontend: ${process.env.FRONTEND_URL}`);
  console.log(`⏰ Hora servidor: ${new Date().toLocaleString('es-ES', {timeZone: 'America/Asuncion'})}`);
  console.log('✅ Listo para recibir pagos!');
  console.log(`📦 Productos cargados: ${Object.keys(productos).length}`);
});
