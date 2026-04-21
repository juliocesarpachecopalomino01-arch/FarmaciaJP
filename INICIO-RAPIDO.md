# 🚀 Guía de Inicio Rápido

## Pasos para Levantar el Sistema

### 1. Verificar que el archivo .env existe
```bash
# El archivo .env debe estar en server/.env
# Si no existe, ejecutar:
npm run setup
```

### 2. Instalar dependencias (si no están instaladas)
```bash
npm run install:all
```

### 3. Levantar el sistema en modo desarrollo
```bash
npm run dev
```

Esto iniciará:
- ✅ **Backend** en: http://localhost:3001
- ✅ **Frontend** en: http://localhost:3000

### 4. Acceder al sistema

1. Abre tu navegador en: **http://localhost:3000**
2. Inicia sesión con:
   - **Usuario**: `admin`
   - **Contraseña**: `admin123`

### 5. ¡Listo! 🎉

El sistema está funcionando. La base de datos se crea automáticamente la primera vez que inicias el servidor.

---

## Comandos Útiles

### Desarrollo
- `npm run dev` - Inicia servidor y cliente en modo desarrollo
- `npm run dev:server` - Solo servidor backend
- `npm run dev:client` - Solo cliente frontend

### Producción
- `npm run build` - Compila todo el proyecto
- `npm start` - Inicia el servidor en modo producción

### Otros
- `npm run setup` - Crea/actualiza el archivo .env
- `cd server && npm run migrate` - Ejecuta migraciones de base de datos

---

## Solución de Problemas

### Error: Puerto ya en uso
Si el puerto 3001 o 3000 está ocupado:
1. Cierra otras aplicaciones que usen esos puertos
2. O cambia el puerto en `server/.env` (PORT=3002)

### Error: No se puede conectar a la base de datos
- Verifica que la carpeta `server/database/` tenga permisos de escritura
- El archivo se crea automáticamente la primera vez

### Error: Módulos no encontrados
```bash
# Reinstalar dependencias
npm run install:all
```

---

## Estructura de URLs

- **Frontend**: http://localhost:3000
- **API Backend**: http://localhost:3001/api
- **Health Check**: http://localhost:3001/api/health
