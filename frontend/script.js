// Configuración
const TU_NUMERO_WHATSAPP = '+595983775018';

// Configuración de productos
const productos = {
    'drumkit-essential': { 
        nombre: 'Drumkit Essential', 
        precio: 25,
        descripcion: '150+ sonidos premium para tus producciones'
    },
    'plantillas-fl': { 
        nombre: 'Plantillas FL Studio', 
        precio: 35,
        descripcion: 'Estructuras profesionales listas para usar'
    },
    'vocal-presets': { 
        nombre: 'Vocal Presets', 
        precio: 20,
        descripcion: 'Chain de efectos para voces profesionales'
    },
    'bundle-completo': { 
        nombre: 'Bundle Completo', 
        precio: 55,
        descripcion: 'Todos los productos con 30% de descuento'
    }
};

// Función para comprar con WhatsApp
function comprarConWhatsApp(nombreProducto, precio) {
    const fecha = new Date().toLocaleDateString();
    
    const mensaje = `*NUEVO PEDIDO - PRODUCCIÓN MUSICAL*
    
📦 *Producto solicitado:* ${nombreProducto}
💰 *Precio:* $${precio} USD
📅 *Fecha:* ${fecha}

👤 *Mi información para el envío:*
• 📧 Email: _______________
• 📱 Teléfono: _______________
• 🏷️ Nombre: _______________

💳 *Método de pago que prefiero:*
[ ] Transferencia bancaria (Ueno/Bancard)
[ ] Tigo Money
[ ] Tarjeta de crédito/débito
[ ] Otro: _____________

Por favor, confírmame los datos para realizar el pago y recibir mi producto. ¡Gracias!`;

    const mensajeCodificado = encodeURIComponent(mensaje);
    const urlWhatsApp = `https://wa.me/${TU_NUMERO_WHATSAPP}?text=${mensajeCodificado}`;
    
    window.open(urlWhatsApp, '_blank');
}

// Función para servicios
function solicitarServicio(nombreServicio, precio) {
    const fecha = new Date().toLocaleDateString();
    
    const mensaje = `*SOLICITUD DE SERVICIO - PRODUCCIÓN MUSICAL*
    
🎵 *Servicio solicitado:* ${nombreServicio}
💰 *Precio:* $${precio} USD
📅 *Fecha:* ${fecha}

👤 *Mi información:*
• 📧 Email: _______________
• 📱 Teléfono: _______________
• 🏷️ Nombre: _______________

📋 *Detalles del proyecto:*
• Género musical: _______________
• Referencias: _______________
• Deadline: _______________

💬 *Comentarios adicionales:*
_________________________

Por favor, contáctame para coordinar los detalles del servicio. ¡Gracias!`;

    const mensajeCodificado = encodeURIComponent(mensaje);
    const urlWhatsApp = `https://wa.me/${TU_NUMERO_WHATSAPP}?text=${mensajeCodificado}`;
    
    window.open(urlWhatsApp, '_blank');
}

// Inicialización cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', function() {
    inicializarEventListeners();
    inicializarScrollEffects();
});

// Configurar event listeners
function inicializarEventListeners() {
    // Smooth scroll para enlaces de navegación
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });

    // Efecto hover mejorado para tarjetas de producto
    document.querySelectorAll('.product-card').forEach(card => {
        card.addEventListener('mouseenter', function() {
            this.style.transform = 'translateY(-8px)';
        });
        
        card.addEventListener('mouseleave', function() {
            this.style.transform = 'translateY(0)';
        });
    });
}

// Efectos de scroll
function inicializarScrollEffects() {
    const header = document.querySelector('.header');
    
    window.addEventListener('scroll', function() {
        const scrollY = window.scrollY;
        
        // Efecto en el header
        if (scrollY > 100) {
            header.style.background = 'rgba(0,0,0,0.95)';
            header.style.padding = '1rem 4rem';
        } else {
            header.style.background = 'rgba(0,0,0,0.9)';
            header.style.padding = '1.5rem 4rem';
        }
        
        // Efecto de aparición en elementos
        animarElementosAlScroll();
    });
}

// Animación de elementos al hacer scroll
function animarElementosAlScroll() {
    const elementos = document.querySelectorAll('.product-card, .section-title');
    
    elementos.forEach(elemento => {
        const elementoTop = elemento.getBoundingClientRect().top;
        const windowHeight = window.innerHeight;
        
        if (elementoTop < windowHeight - 100) {
            elemento.style.opacity = '1';
            elemento.style.transform = 'translateY(0)';
        }
    });
}

// Efectos de inicialización
setTimeout(() => {
    document.querySelectorAll('.product-card, .section-title').forEach(el => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(20px)';
        el.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
    });
    
    // Trigger inicial para animaciones
    animarElementosAlScroll();
}, 100);