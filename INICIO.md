# 🚀 Guía de Inicio - Sistema de Farmacia

## 📋 Requisitos Previos

- Node.js (versión 18 o superior)
- npm (viene con Node.js)

## 🔧 Instalación y Configuración

### Paso 1: Instalar todas las dependencias

Desde la raíz del proyecto, ejecuta:

```bash
npm run install:all
```

Este comando instalará las dependencias de:
- Proyecto raíz
- Servidor (backend)
- Cliente (frontend)

### Paso 2: Configurar variables de entorno

Si no tienes el archivo `.env` en la carpeta `server/`, ejecuta:

```bash
npm run setup
```

Esto creará automáticamente el archivo `.env` con las configuraciones necesarias.

### Paso 3: Verificar archivo .env

Asegúrate de que el archivo `server/.env` contenga al menos:

```
PORT=3001
JWT_SECRET=tu_secret_key_muy_segura_aqui
```

## ▶️ Iniciar el Sistema

### Opción 1: Desarrollo (Recomendado)

Para iniciar tanto el servidor como el cliente en modo desarrollo:

```bash
npm run dev
```

Esto iniciará:
- **Backend**: http://localhost:3001
- **Frontend**: http://localhost:5173 (o el puerto que Vite asigne)

### Opción 2: Iniciar por separado

**Terminal 1 - Backend:**
```bash
npm run dev:server
```

**Terminal 2 - Frontend:**
```bash
npm run dev:client
```

## 🌐 Acceso al Sistema

1. Abre tu navegador en: **http://localhost:5173** (o el puerto que muestre Vite)

2. **Credenciales por defecto:**
   - Usuario: `admin`
   - Contraseña: `admin123`

   ⚠️ **IMPORTANTE**: Cambia estas credenciales después del primer inicio.

## 📦 Nuevas Funcionalidades Disponibles

### ✅ Funcionalidades Implementadas:

1. **Búsqueda por código de barras** en ventas
2. **Impresión de tickets/recibos** (PDF)
3. **Alertas de vencimiento** de productos
4. **Log de auditoría** completo
5. **Exportación a Excel** de reportes
6. **Ventas pendientes/borradores**
7. **Sistema de devoluciones**
8. **Gestión de proveedores y compras**
9. **Gráficos y visualizaciones**
10. **Historial de compras del cliente**
11. **Múltiples métodos de pago** en una venta
12. **Búsqueda global** (Ctrl+K)
13. **Sistema de notificaciones**
14. **Validaciones mejoradas**
15. **Lotes y control de vencimientos**

## 🔍 Verificar que todo funciona

1. **Dashboard**: Deberías ver estadísticas y alertas
2. **Productos**: Puedes crear productos con fechas de vencimiento
3. **Ventas**: Prueba la búsqueda por código de barras
4. **Reportes**: Verifica los gráficos y exportaciones
5. **Notificaciones**: Click en el ícono de campana en el header

## ⚠️ Solución de Problemas

### Error: "Cannot find module 'xlsx'"
```bash
cd server
npm install xlsx
```

### Error: "Cannot find module 'recharts'"
```bash
cd client
npm install recharts
```

### Error: "Port already in use"
- Cambia el puerto en `server/.env` (PORT=3002)
- O cierra el proceso que está usando el puerto

### Error de base de datos
- El sistema creará automáticamente la base de datos SQLite en `server/database.db`
- Si hay problemas, elimina `server/database.db` y reinicia el servidor

## 📝 Comandos Útiles

```bash
# Instalar todas las dependencias
npm run install:all

# Iniciar en desarrollo (servidor + cliente)
npm run dev

# Solo servidor
npm run dev:server

# Solo cliente
npm run dev:client

# Construir para producción
npm run build

# Iniciar en producción
npm start
```

## 🎯 Próximos Pasos

1. Cambiar credenciales del administrador
2. Configurar categorías de productos
3. Agregar productos al inventario
4. Configurar proveedores
5. Personalizar según tus necesidades

---

¡Listo! Tu sistema de farmacia está completamente funcional con todas las mejoras implementadas. 🎉
