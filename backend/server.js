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

// ==================== KEEP-ALIVE INTELIGENTE ====================
// Mantiene Render activo 24/7 sin pasarse del límite free
let keepAliveActivado = true;
let totalPings = 0;
const MAX_PINGS_MENSUALES = 10000; // ~750 horas de keep-alive

function iniciarKeepAlive() {
  console.log('🔄 Keep-alive inteligente iniciado');
  console.log(`📊 Límite mensual: ${MAX_PINGS_MENSUALES} pings (~750 horas)`);
  
  // Función para hacer ping
  async function hacerPing() {
    if (!keepAliveActivado) {
      return;
    }
    
    totalPings++;
    
    // Verificar límite (dejar 10% de margen)
    if (totalPings >= MAX_PINGS_MENSUALES * 0.9) {
      console.log('⚠️  ALERTA: Límite mensual al 90% - Pausando keep-alive');
      keepAliveActivado = false;
      return;
    }
    
    try {
      // Ping a la base de datos (mantiene ambas conexiones activas)
      const client = await pool.connect();
      await client.query('SELECT 1');
      client.release();
      
      // Log cada 10 pings (~45 minutos)
      if (totalPings % 10 === 0) {
        const porcentaje = (totalPings / MAX_PINGS_MENSUALES * 100).toFixed(1);
        const horasUsadas = ((totalPings * 4.5) / 60).toFixed(1);
        console.log(`🫀 Keep-alive: ${totalPings}/${MAX_PINGS_MENSUALES} (${porcentaje}%) - ${horasUsadas}h usadas`);
      }
      
    } catch (error) {
      console.log('⚠️  Keep-alive DB error:', error.message);
    }
  }
  
  // Ejecutar cada 4.5 minutos (antes de que Render suspenda a los 5min)
  const intervalo = setInterval(hacerPing, 4.5 * 60 * 1000);
  
  // Hacer primer ping inmediato
  setTimeout(hacerPing, 10000);
  
  return intervalo;
}

// ==================== ENDPOINTS DE CONTROL ====================

// 1. Panel web de control COMPLETO con historial de ventas
app.get('/admin/keepalive-panel', async (req, res) => {
  try {
    // Obtener estadísticas de ventas
    const ventasMes = await pool.query(`
      SELECT 
        COUNT(*) as total,
        SUM(precio_pagado) as ingresos,
        AVG(precio_pagado) as promedio,
        MIN(creado_en) as primera,
        MAX(creado_en) as ultima
      FROM pedidos 
      WHERE status = 'completed' 
      AND creado_en >= DATE_TRUNC('month', NOW())
    `);

    // Obtener últimos 10 pedidos
    const ultimosPedidos = await pool.query(`
      SELECT producto_nombre, precio_pagado, cliente_email, creado_en
      FROM pedidos 
      WHERE status = 'completed'
      ORDER BY creado_en DESC
      LIMIT 10
    `);

    // Ventas por producto
    const ventasPorProducto = await pool.query(`
      SELECT producto_nombre, COUNT(*) as cantidad, SUM(precio_pagado) as total
      FROM pedidos 
      WHERE status = 'completed'
      AND creado_en >= DATE_TRUNC('month', NOW())
      GROUP BY producto_nombre
      ORDER BY total DESC
    `);

    const porcentaje = (totalPings / MAX_PINGS_MENSUALES * 100).toFixed(2);
    const horasUsadas = ((totalPings * 4.5) / 60).toFixed(1);
    const ventasData = ventasMes.rows[0] || { total: 0, ingresos: 0, promedio: 0 };

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>🔋 Dashboard ProdByMTR</title>
        <style>
          body {
            background: #000;
            color: #fff;
            font-family: Arial, sans-serif;
            padding: 20px;
            max-width: 1000px;
            margin: 0 auto;
          }
          .header {
            text-align: center;
            margin-bottom: 30px;
            border-bottom: 2px solid #635bff;
            padding-bottom: 20px;
          }
          .dashboard-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
          }
          .card {
            background: #1a1a1a;
            padding: 25px;
            border-radius: 10px;
            border-left: 5px solid #635bff;
          }
          .card-keepalive {
            border-left-color: ${keepAliveActivado ? '#4CAF50' : '#ff9800'};
          }
          .card-ventas {
            border-left-color: #4CAF50;
          }
          .card-pedidos {
            border-left-color: #ff9800;
          }
          .card-productos {
            border-left-color: #9c27b0;
          }
          h2 {
            color: #635bff;
            margin-bottom: 20px;
            font-size: 1.5rem;
          }
          .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
            gap: 15px;
            margin: 20px 0;
          }
          .stat-item {
            background: #222;
            padding: 15px;
            border-radius: 8px;
            text-align: center;
          }
          .stat-value {
            font-size: 24px;
            font-weight: bold;
            color: #635bff;
            margin: 10px 0;
          }
          .stat-label {
            font-size: 12px;
            color: #888;
            text-transform: uppercase;
          }
          .progress-bar {
            width: 100%;
            height: 30px;
            background: #333;
            border-radius: 15px;
            overflow: hidden;
            margin: 20px 0;
          }
          .progress-fill {
            height: 100%;
            background: ${porcentaje < 70 ? '#4CAF50' : porcentaje < 90 ? '#ff9800' : '#f44336'};
            width: ${porcentaje}%;
            transition: width 0.3s;
          }
          .table-container {
            overflow-x: auto;
            margin: 20px 0;
          }
          table {
            width: 100%;
            border-collapse: collapse;
          }
          th, td {
            padding: 12px 15px;
            text-align: left;
            border-bottom: 1px solid #333;
          }
          th {
            background: #222;
            color: #635bff;
            font-weight: bold;
          }
          tr:hover {
            background: #222;
          }
          .controls {
            text-align: center;
            margin-top: 30px;
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
            justify-content: center;
          }
          .btn {
            background: #635bff;
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 6px;
            font-size: 14px;
            cursor: pointer;
            text-decoration: none;
            display: inline-block;
            transition: all 0.3s;
          }
          .btn:hover {
            background: #5a54d9;
            transform: translateY(-2px);
          }
          .btn-pause {
            background: ${keepAliveActivado ? '#ff9800' : '#4CAF50'};
          }
          .btn-small {
            padding: 8px 16px;
            font-size: 12px;
          }
          .info {
            color: #888;
            font-size: 12px;
            margin-top: 30px;
            text-align: center;
            padding-top: 20px;
            border-top: 1px solid #333;
          }
          .badge {
            background: #4CAF50;
            color: white;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: bold;
          }
          .price {
            color: #4CAF50;
            font-weight: bold;
          }
          .email {
            font-size: 12px;
            color: #888;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            max-width: 200px;
          }
          @media (max-width: 768px) {
            body { padding: 10px; }
            .card { padding: 15px; }
            .stat-value { font-size: 20px; }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>📊 Dashboard ProdByMTR</h1>
          <p>Control completo de tu negocio de producción musical</p>
        </div>
        
        <div class="dashboard-grid">
          <!-- Card 1: Keep-Alive Status -->
          <div class="card card-keepalive">
            <h2>🔋 Keep-Alive Status</h2>
            <div class="progress-bar">
              <div class="progress-fill"></div>
            </div>
            <div style="text-align: center; margin: 15px 0;">
              <strong>${porcentaje}%</strong> del límite mensual usado
              <div style="font-size: 12px; color: #888;">${horasUsadas}h / ~750h mensuales</div>
            </div>
            
            <div class="stats-grid">
              <div class="stat-item">
                <div class="stat-label">Pings</div>
                <div class="stat-value">${totalPings}</div>
                <div>de ${MAX_PINGS_MENSUALES}</div>
              </div>
              <div class="stat-item">
                <div class="stat-label">Estado</div>
                <div class="stat-value">${keepAliveActivado ? '✅' : '⏸️'}</div>
                <div>${keepAliveActivado ? 'ACTIVO' : 'PAUSADO'}</div>
              </div>
              <div class="stat-item">
                <div class="stat-label">Días Rest.</div>
                <div class="stat-value">${((750 - parseFloat(horasUsadas)) / 24).toFixed(1)}</div>
                <div>a 24h/día</div>
              </div>
            </div>
          </div>
          
          <!-- Card 2: Ventas del Mes -->
          <div class="card card-ventas">
            <h2>💰 Ventas del Mes</h2>
            <div class="stats-grid">
              <div class="stat-item">
                <div class="stat-label">Total Ventas</div>
                <div class="stat-value">${ventasData.total || 0}</div>
                <div>pedidos</div>
              </div>
              <div class="stat-item">
                <div class="stat-label">Ingresos</div>
                <div class="stat-value">$${ventasData.ingresos || 0}</div>
                <div>USD</div>
              </div>
              <div class="stat-item">
                <div class="stat-label">Promedio</div>
                <div class="stat-value">$${ventasData.promedio ? parseFloat(ventasData.promedio).toFixed(2) : '0.00'}</div>
                <div>por venta</div>
              </div>
            </div>
            
            ${ventasData.primera ? `
              <div style="margin-top: 15px; font-size: 12px; color: #888;">
                <div>📅 Primera venta: ${new Date(ventasData.primera).toLocaleDateString('es-PY')}</div>
                <div>📅 Última venta: ${new Date(ventasData.ultima).toLocaleDateString('es-PY')}</div>
              </div>
            ` : ''}
          </div>
        </div>
        
        <!-- Card 3: Últimos Pedidos -->
        <div class="card card-pedidos">
          <h2>📦 Últimos 10 Pedidos</h2>
          ${ultimosPedidos.rows.length > 0 ? `
            <div class="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>Precio</th>
                    <th>Cliente</th>
                    <th>Fecha</th>
                  </tr>
                </thead>
                <tbody>
                  ${ultimosPedidos.rows.map(pedido => `
                    <tr>
                      <td>${pedido.producto_nombre}</td>
                      <td class="price">$${pedido.precio_pagado} USD</td>
                      <td><span class="email" title="${pedido.cliente_email || 'No email'}">${pedido.cliente_email || 'No email'}</span></td>
                      <td>${new Date(pedido.creado_en).toLocaleDateString('es-PY', { hour: '2-digit', minute: '2-digit' })}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          ` : '<p style="text-align: center; color: #888;">No hay pedidos aún</p>'}
        </div>
        
        <!-- Card 4: Ventas por Producto -->
        ${ventasPorProducto.rows.length > 0 ? `
          <div class="card card-productos">
            <h2>📊 Ventas por Producto (este mes)</h2>
            <div class="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>Cantidad</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  ${ventasPorProducto.rows.map(producto => `
                    <tr>
                      <td>${producto.producto_nombre}</td>
                      <td><span class="badge">${producto.cantidad}</span></td>
                      <td class="price">$${parseFloat(producto.total).toFixed(2)} USD</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        ` : ''}
        
        <div class="controls">
          <a href="/admin/keepalive-control?action=${keepAliveActivado ? 'pause' : 'resume'}" 
             class="btn btn-pause">
             ${keepAliveActivado ? '⏸️ PAUSAR Keep-Alive' : '▶️ REANUDAR Keep-Alive'}
          </a>
          <a href="/admin/keepalive-status" class="btn" target="_blank">
            📊 JSON Status
          </a>
          <a href="/api/health" class="btn" target="_blank">
            ❤️ Health Check
          </a>
          <a href="/api/pedidos" class="btn" target="_blank">
            📦 Todos los Pedidos
          </a>
          <a href="https://matirodas50-eng.github.io/prodby-MTR/" class="btn" target="_blank">
            🎵 Ir a la Tienda
          </a>
        </div>
        
        <div class="info">
          <p>📅 Acceso rápido desde tu teléfono: <code>https://prodbymtr-backend.onrender.com/admin/keepalive-panel</code></p>
          <p>⏰ Última actualización: ${new Date().toLocaleString('es-PY', { timeZone: 'America/Asuncion' })}</p>
          <p>🔧 Panel automático - Se actualiza cada 60 segundos</p>
        </div>
        
        <script>
          // Auto-refrescar cada 60 segundos
          setTimeout(() => location.reload(), 60000);
          
          // Formatear números
          document.addEventListener('DOMContentLoaded', function() {
            // Formatear precios
            document.querySelectorAll('.price').forEach(el => {
              const price = parseFloat(el.textContent.replace(/[^0-9.]/g, ''));
              if (!isNaN(price)) {
                el.textContent = '$' + price.toFixed(2) + ' USD';
              }
            });
          });
        </script>
      </body>
      </html>
    `);
  } catch (error) {
    res.send(`
      <html><body style="background:#000;color:#fff;padding:20px;">
        <h1>❌ Error cargando dashboard</h1>
        <p>${error.message}</p>
        <a href="/admin/keepalive-panel" class="btn">Reintentar</a>
      </body></html>
    `);
  }
});

// 2. Endpoint JSON para apps
app.get('/admin/keepalive-status', (req, res) => {
  const porcentaje = (totalPings / MAX_PINGS_MENSUALES * 100).toFixed(2);
  res.json({
    keepAliveActive: keepAliveActivado,
    totalPings: totalPings,
    monthlyLimit: MAX_PINGS_MENSUALES,
    percentageUsed: porcentaje + '%',
    hoursEquivalent: ((totalPings * 4.5) / 60).toFixed(1) + ' hours',
    daysLeftAt24h: ((750 - (totalPings * 4.5) / 60) / 24).toFixed(1) + ' days',
    serverTime: new Date().toLocaleString('es-ES', { timeZone: 'America/Asuncion' }),
    nextAutoPing: 'in ' + (4.5 - ((Date.now() % (4.5 * 60 * 1000)) / (60 * 1000))).toFixed(1) + ' minutes',
    recommendation: porcentaje > 90 ? 'PAUSE keep-alive' : porcentaje > 70 ? 'MONITOR closely' : 'OK to continue'
  });
});

// 3. Control manual (pausar/reanudar)
app.post('/admin/keepalive-control', (req, res) => {
  const action = req.query.action;
  
  if (action === 'pause') {
    keepAliveActivado = false;
    console.log('⏸️ Keep-alive PAUSADO manualmente');
    res.json({ 
      status: 'PAUSED', 
      message: 'Keep-alive pausado. El servidor se suspenderá después de 15 minutos sin tráfico.',
      totalPings: totalPings,
      timestamp: new Date().toISOString()
    });
    
  } else if (action === 'resume') {
    keepAliveActivado = true;
    console.log('▶️ Keep-alive REANUDADO manualmente');
    res.json({ 
      status: 'ACTIVE', 
      message: 'Keep-alive reanudado. El servidor se mantendrá activo.',
      totalPings: totalPings,
      timestamp: new Date().toISOString()
    });
    
  } else {
    res.status(400).json({ error: 'Acción no válida. Usa ?action=pause o ?action=resume' });
  }
});

// 4. Endpoint de estadísticas avanzadas
app.get('/admin/stats-detailed', async (req, res) => {
  try {
    const ventasMes = await pool.query(`
      SELECT 
        COUNT(*) as total_pedidos,
        SUM(precio_pagado) as ingresos_totales,
        AVG(precio_pagado) as promedio_venta,
        MIN(creado_en) as primera_venta,
        MAX(creado_en) as ultima_venta
      FROM pedidos 
      WHERE status = 'completed'
    `);

    const ventasPorProducto = await pool.query(`
      SELECT producto_nombre, COUNT(*) as cantidad, SUM(precio_pagado) as total
      FROM pedidos 
      WHERE status = 'completed'
      AND creado_en >= DATE_TRUNC('month', NOW())
      GROUP BY producto_nombre
      ORDER BY total DESC
    `);

    res.json({
      keepAlive: {
        active: keepAliveActivado,
        pings: totalPings,
        limit: MAX_PINGS_MENSUALES,
        percentage: (totalPings / MAX_PINGS_MENSUALES * 100).toFixed(2) + '%'
      },
      ventas_mes: ventasMes.rows[0] || {},
      ventas_por_producto: ventasPorProducto.rows,
      servidor: {
        uptime: process.uptime() + ' seconds',
        memory: process.memoryUsage(),
        time: new Date().toISOString()
      }
    });
    
  } catch (error) {
    res.json({ error: error.message });
  }
});

// 5. Endpoint de alertas de ventas
app.get('/admin/alerta-ventas', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT COUNT(*) as ventas_mes 
      FROM pedidos 
      WHERE status = 'completed' 
      AND creado_en >= DATE_TRUNC('month', NOW())
    `);
    
    const ventas = parseInt(result.rows[0].ventas_mes);
    
    // Alerta si hay 5+ ventas este mes (considerar upgrade)
    if (ventas >= 5) {
      console.log('🚀 ¡Alerta! 5+ ventas este mes - Considera upgrade a Render Basic ($7/mes)');
    }
    
    res.json({ 
      ventas_este_mes: ventas,
      recomendacion: ventas >= 5 ? 'Considera upgrade a Render Basic ($7/mes) para mejor performance' : 'OK en free tier'
    });
    
  } catch (error) {
    res.json({ error: error.message, ventas_este_mes: 0 });
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
  
  // Iniciar keep-alive después de 30 segundos
  setTimeout(() => {
    iniciarKeepAlive();
    console.log('🔋 Keep-alive inteligente configurado');
    console.log('📊 Panel de control: https://prodbymtr-backend.onrender.com/admin/keepalive-panel');
    console.log('📊 Estadísticas: https://prodbymtr-backend.onrender.com/admin/keepalive-status');
    console.log('💰 Alertas ventas: https://prodbymtr-backend.onrender.com/admin/alerta-ventas');
    
    // Verificar si es primer día del mes para resetear contador
    const hoy = new Date();
    if (hoy.getDate() === 1) {
      totalPings = 0;
      console.log('🔄 Primer día del mes - Contador keep-alive reiniciado');
    }
  }, 30000);
});
