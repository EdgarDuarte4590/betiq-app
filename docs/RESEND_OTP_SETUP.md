# Futura Implementación: Flujo de Login con OTP (Resend)

Actualmente (v3.0), el sistema usa autenticación clásica de **Email + Contraseña** gestionada directamente por Supabase. Esta es la solución más rápida y eficiente dado que actualmente hay un único usuario (el administrador).

Para escalar a múltiples usuarios en el futuro de manera más segura y sin depender de contraseñas (Passwordless), se planeó un flujo de **OTP (One Time Password)** de 6 dígitos enviado por correo.

Aquí queda documentado cómo se implementará cuando sea el momento.

## Arquitectura del OTP

1. **Tabla en Supabase**: `auth_otp`
   - Guarda los códigos OTP de forma segura (hasheados).
   - Registra fecha de expiración (ej. 5 minutos).
   - Registra si ya fue usado.
2. **Servicio de Email**: [Resend](https://resend.com/)
   - Plataforma para envío de emails transaccionales (gratis hasta 3,000 al mes).
   - Se usará para enviar el correo con el código de 6 dígitos.
3. **Flujo del Usuario**:
   - El usuario ingresa su email en la página de login.
   - El sistema genera un código de 6 dígitos aleatorio.
   - Guarda el hash del código en `auth_otp` asociado al email.
   - Envía el código real por Resend.
   - La UI muestra una pantalla para ingresar los 6 dígitos.
   - Si el código coincide (comparando el hash) y no ha expirado, se emite una sesión de Supabase (usando service role para hacer bypass de la contraseña).

## Pasos para la Implementación Futura

1. **Crear cuenta en Resend**:
   - Ir a resend.com y registrarse.
   - Añadir y verificar un dominio (necesario para alta entregabilidad).
   - Generar una API Key.
   - Añadir `RESEND_API_KEY` a las variables de entorno de Vercel.

2. **Endpoints de API necesarios**:
   - `POST /api/auth/request-otp`: Recibe el email, genera el código, lo guarda en BD y llama a Resend.
   - `POST /api/auth/verify-otp`: Recibe email y código. Verifica en la BD. Si es válido, inicia sesión en Supabase y devuelve las cookies.

3. **Modificaciones en UI**:
   - Actualizar `app/login/page.tsx` para cambiar del modo "Contraseña" al modo "Ingresar Código".
   - Eliminar `app/register/page.tsx` ya que el flujo OTP sirve tanto para login como para registro (si el usuario no existe, se crea).

## Esquema de Base de Datos (Ya preparado)

La tabla ya fue creada en `supabase/schema.sql` durante la fase M0:

```sql
CREATE TABLE IF NOT EXISTS auth_otp (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text        NOT NULL,
  otp_hash    text        NOT NULL,            -- SHA-256 del código de 6 dígitos
  expires_at  timestamptz NOT NULL DEFAULT (now() + interval '5 minutes'),
  used        boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
```
