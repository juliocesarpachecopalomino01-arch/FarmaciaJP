# Sistema de Farmacia Web - Open Source

Sistema completo de gestión para farmacias, desarrollado con tecnologías modernas y completamente dinámico. No está diseñado para SUNAT ni ningún sistema tributario específico.

## 🚀 Características

- **Gestión de Productos**: CRUD completo de productos con códigos de barras, categorías y precios
- **Inventario Dinámico**: Control de stock con alertas de stock bajo, entradas, salidas y ajustes
- **Sistema de Ventas**: Procesamiento de ventas con múltiples métodos de pago
- **Gestión de Clientes**: Base de datos de clientes con información completa
- **Categorías**: Organización dinámica de productos por categorías
- **Reportes**: Reportes de ventas, productos más vendidos, inventario y clientes
- **Usuarios y Roles**: Sistema de autenticación con roles (admin/empleado)
- **Interfaz Moderna**: UI responsive y fácil de usar

## 🛠️ Tecnologías

### Backend
- Node.js + Express
- TypeScript
- SQLite (fácil migración a PostgreSQL/MySQL)
- JWT para autenticación
- bcrypt para encriptación de contraseñas

### Frontend
- React 18
- TypeScript
- Vite
- React Query para gestión de estado del servidor
- Lucide React para iconos
- CSS moderno con variables CSS

## 📦 Instalación

### Requisitos Previos
- Node.js 18+ y npm

### Pasos de Instalación

1. **Clonar o descargar el repositorio**

2. **Instalar dependencias de todos los módulos:**
```bash
npm run install:all
```

3. **Configurar variables de entorno:**

El archivo `.env` se crea automáticamente ejecutando:
```bash
npm run setup
```

O manualmente, el archivo `.env` ya está creado en `server/.env` con la siguiente configuración:
```
PORT=3001
JWT_SECRET=your-secret-key-change-this-in-production-make-it-long-and-random
NODE_ENV=development
DB_PATH=./database/farmacia.db
AUDIT_PASSWORD=admin123
```

| Variable | Descripción |
|----------|-------------|
| `PORT` | Puerto del servidor (default: 3001) |
| `JWT_SECRET` | Clave para firmar tokens JWT. **Cambiar en producción** |
| `AUDIT_PASSWORD` | Contraseña para eliminar compras, reabrir caja cerrada (default: admin123) |
| `DB_PATH` | Ruta del archivo SQLite |

**⚠️ IMPORTANTE**: En producción, cambiar el `JWT_SECRET` y `AUDIT_PASSWORD` por valores seguros.

4. **Inicializar la base de datos:**
```bash
cd server
npm run migrate
```

O simplemente iniciar el servidor, la base de datos se creará automáticamente.

## 🚀 Uso

### Desarrollo

Para ejecutar tanto el servidor como el cliente en modo desarrollo:

```bash
npm run dev
```

Esto iniciará:
- Backend en: http://localhost:3001
- Frontend en: http://localhost:3000

### Producción

1. **Compilar el proyecto:**
```bash
npm run build
```

2. **Iniciar el servidor:**
```bash
npm start
```

El frontend compilado se servirá desde el backend.

## 👤 Usuario por Defecto

Al iniciar por primera vez, se crea un usuario administrador:

- **Usuario**: `admin`
- **Contraseña**: `admin123`

**⚠️ IMPORTANTE**: Cambiar la contraseña del administrador después del primer inicio.

## 🔑 Contraseñas del Sistema

Las siguientes operaciones sensibles requieren contraseña. Por defecto se usa `admin123` (configurable con `AUDIT_PASSWORD`):

| Operación | Descripción | Contraseña aceptada |
|-----------|-------------|---------------------|
| **Eliminar compra** | Al eliminar una compra (revierte inventario y movimientos de caja) | `AUDIT_PASSWORD` o contraseña del admin |
| **Reabrir caja cerrada** | Aperturar una caja ya cerrada para auditoría/arqueo | `AUDIT_PASSWORD` o contraseña del admin |
| **Cancelar venta** | Actualmente solo requiere estar autenticado (sin contraseña extra) | - |
| **Desactivar usuario** | Solo administradores pueden desactivar usuarios | Rol admin (sin contraseña adicional) |

### Configuración de contraseñas

En el archivo `server/.env` o variables de entorno:

```
AUDIT_PASSWORD=admin123
```

- **AUDIT_PASSWORD**: Contraseña para operaciones de auditoría (eliminar compras, reabrir caja cerrada). Por defecto: `admin123`.
- Los usuarios con rol **admin** pueden usar su propia contraseña en lugar de `AUDIT_PASSWORD` para estas operaciones.

## 📁 Estructura del Proyecto

```
FarmaciaJP/
├── server/                 # Backend
│   ├── src/
│   │   ├── routes/        # Rutas de la API
│   │   ├── database/      # Configuración de BD
│   │   ├── middleware/    # Middleware (auth, etc.)
│   │   └── server.ts      # Punto de entrada
│   └── database/          # Base de datos SQLite
│
├── client/                # Frontend
│   ├── src/
│   │   ├── api/          # Clientes API
│   │   ├── components/   # Componentes React
│   │   ├── hooks/       # Custom hooks
│   │   ├── pages/       # Páginas principales
│   │   └── App.tsx      # Componente principal
│   └── public/          # Archivos estáticos
│
└── package.json         # Scripts principales
```

## 👥 Gestión de Usuarios

### Funcionalidad actual

- **Crear usuarios**: Mediante API `POST /api/auth/register` (requiere integración en la interfaz de Usuarios)
- **Desactivar usuarios**: Solo administradores pueden desactivar usuarios desde `/users`
- **Editar usuarios**: Nombre, email, rol (admin/empleado)
- **Cambiar contraseña**: El usuario puede cambiar la suya; el admin puede cambiar la de cualquier usuario

### Roles

- **admin**: Acceso total, incluida la gestión de usuarios
- **employee**: Acceso a todos los módulos excepto Usuarios

### Módulos del sistema (permisos por ruta)

Cada módulo corresponde a una ruta en la aplicación:

| Ruta | Módulo | Descripción |
|------|--------|-------------|
| `/` | Dashboard | Panel principal |
| `/products` | Productos | Gestión de productos |
| `/categories` | Categorías | Categorías de productos |
| `/inventory` | Inventario | Control de stock |
| `/sales` | Ventas | Registro de ventas |
| `/cash-register` | Caja | Apertura y cierre de caja |
| `/cash-movements` | Movimientos de Caja | Historial de ventas y compras que afectan caja |
| `/alerts` | Alertas | Alertas de stock bajo y vencimientos |
| `/customers` | Clientes | Base de clientes |
| `/reports` | Reportes | Reportes de ventas, inventario, etc. |
| `/returns` | Devoluciones | Devoluciones de ventas |
| `/suppliers` | Proveedores | Gestión de proveedores |
| `/purchases` | Compras | Compras a proveedores |
| `/scan-qr` | Escanear QR | Consulta de productos por código QR |
| `/users` | Usuarios | Gestión de usuarios (solo admin) |

### Permisos por módulo

El sistema incluye permisos granulares por módulo para usuarios con rol **empleado**:

- Al crear o editar un empleado, se puede marcar qué módulos puede acceder (Productos, Categorías, Inventario, Ventas, etc.).
- Los administradores tienen acceso total a todos los módulos.
- Los empleados sin permisos configurados solo ven el Dashboard hasta que un admin les asigne permisos.

## 🔐 Autenticación

El sistema utiliza JWT (JSON Web Tokens) para la autenticación. Los tokens se almacenan en localStorage y se envían automáticamente en cada solicitud.

## 📊 API Endpoints

### Autenticación
- `POST /api/auth/login` - Iniciar sesión
- `POST /api/auth/register` - Crear usuario (username, email, password, full_name, role)
- `GET /api/auth/me` - Obtener usuario actual

### Usuarios
- `GET /api/users` - Listar usuarios (admin)
- `GET /api/users/:id` - Obtener usuario
- `PUT /api/users/:id` - Actualizar usuario (email, full_name, role, is_active)
- `PUT /api/users/:id/password` - Cambiar contraseña
- `DELETE /api/users/:id` - Desactivar usuario (admin)

### Productos
- `GET /api/products` - Listar productos
- `GET /api/products/:id` - Obtener producto
- `POST /api/products` - Crear producto
- `PUT /api/products/:id` - Actualizar producto
- `DELETE /api/products/:id` - Eliminar producto

### Categorías
- `GET /api/categories` - Listar categorías
- `POST /api/categories` - Crear categoría
- `PUT /api/categories/:id` - Actualizar categoría
- `DELETE /api/categories/:id` - Eliminar categoría

### Inventario
- `GET /api/inventory` - Listar inventario
- `PUT /api/inventory/:id` - Actualizar niveles de stock
- `POST /api/inventory/movement` - Registrar movimiento
- `GET /api/inventory/movements` - Historial de movimientos

### Ventas
- `GET /api/sales` - Listar ventas
- `GET /api/sales/:id` - Obtener venta
- `POST /api/sales` - Crear venta
- `DELETE /api/sales/:id` - Cancelar venta

### Clientes
- `GET /api/customers` - Listar clientes
- `POST /api/customers` - Crear cliente
- `PUT /api/customers/:id` - Actualizar cliente
- `DELETE /api/customers/:id` - Eliminar cliente

### Reportes
- `GET /api/reports/sales` - Reporte de ventas
- `GET /api/reports/top-products` - Productos más vendidos
- `GET /api/reports/inventory` - Reporte de inventario
- `GET /api/reports/customers` - Reporte de clientes

## 🎨 Personalización

El sistema está diseñado para ser completamente personalizable:

- **Colores**: Modificar las variables CSS en `client/src/index.css`
- **Base de datos**: Fácil migración a PostgreSQL o MySQL cambiando la configuración
- **Campos adicionales**: Agregar campos a las tablas según necesidades

## 📝 Licencia

MIT License - Open Source

## 🤝 Contribuciones

Las contribuciones son bienvenidas. Por favor:

1. Fork el proyecto
2. Crea una rama para tu feature (`git checkout -b feature/AmazingFeature`)
3. Commit tus cambios (`git commit -m 'Add some AmazingFeature'`)
4. Push a la rama (`git push origin feature/AmazingFeature`)
5. Abre un Pull Request

## ⚠️ Notas Importantes

- Este sistema **NO está diseñado para SUNAT** ni ningún sistema tributario específico
- La base de datos SQLite es adecuada para desarrollo y pequeñas implementaciones
- Para producción, se recomienda migrar a PostgreSQL o MySQL
- Cambiar el `JWT_SECRET` en producción
- Implementar backups regulares de la base de datos

## 🐛 Reportar Problemas

Si encuentras algún problema, por favor abre un issue en el repositorio.

## 📧 Soporte

Para soporte, por favor abre un issue en el repositorio del proyecto.

---

Desarrollado con ❤️ para la comunidad open source
