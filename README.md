# TableLive

Dominó multijugador en tiempo real para 2, 3 o 4 personas, con video y voz
integrados (usando Jitsi Meet, gratis, sin necesidad de crear cuenta).

## Reglas implementadas

- Set doble-6 completo (28 fichas)
- Reparto: 12 fichas por jugador si son 2, 9 si son 3, 6 si son 4
- Empieza quien tenga el doble más alto en su mano
- En cada turno: jugás una ficha que encaje en algún extremo del tablero,
  o pasás si no tenés ninguna que encaje
- Ganás si te quedás sin fichas, o si el juego se traba (nadie puede jugar)
  y vos tenés menos puntos sumados en tu mano

## Cómo correrlo en tu compu

1. Necesitás Node.js instalado (https://nodejs.org, versión LTS)
2. Abrí una terminal en esta carpeta
3. Corré:
   ```
   npm install
   node server.js
   ```
4. Abrí `http://localhost:3000` en el navegador

## Cómo jugar

1. Escribí tu nombre
2. **Para crear una sala**: elegí cuántos van a jugar (2, 3 o 4) y hacé clic
   en "Crear sala". Te va a dar un código de 5 letras — compartilo con los
   demás.
3. **Para unirte**: escribí el código que te compartieron y hacé clic en
   "Unirme"
4. Cuando se completa la cantidad de jugadores, la partida arranca sola
5. El video y el audio se conectan automáticamente entre todos los que
   están en la misma sala

## Cómo ponerlo online (para jugar desde casas distintas)

Mismo proceso que hicimos con ChrisHook:
1. Subí esta carpeta a un repositorio nuevo en GitHub (podés llamarlo
   `domino-online`)
2. Conectalo a Render.com como "Web Service"
3. Build Command: `npm install`
4. Start Command: `node server.js`
5. Plan: Free

## Sistema de regalos (gemas con PayPal)

Los jugadores pueden comprar "gemas" con dinero real y regalárselas a otro
jugador durante la partida (como una propina). **Esto NO es apuestas**: nadie
gana plata de otro por ganar el juego, es un regalo voluntario, igual que los
regalos de TikTok o las propinas de Twitch.

### Cómo activarlo

1. Andá a https://developer.paypal.com y creá una cuenta (podés usar tu
   cuenta de PayPal normal)
2. En el panel, creá una "App" nueva — te va a dar un **Client ID** y un
   **Client Secret**
3. Arrancá en modo **Sandbox** (pruebas, sin plata real) hasta que confirmes
   que todo funciona bien
4. Configurá estas variables de entorno donde despliegues el proyecto
   (en Render.com: Settings → Environment):
   ```
   PAYPAL_CLIENT_ID=tu_client_id
   PAYPAL_CLIENT_SECRET=tu_client_secret
   PAYPAL_API_BASE=https://api-m.sandbox.paypal.com
   ```
5. Cuando estés listo para plata real, cambiás `PAYPAL_API_BASE` a
   `https://api-m.paypal.com` y usás las llaves de producción (no sandbox)

### Cómo funcionan los retiros

Cuando alguien pide retirar sus gemas, el pedido queda guardado en el
archivo `withdrawals.json` (en el servidor). **Vos tenés que revisarlo y
mandar la plata a mano** por PayPal a cada persona — no hay pago automático
todavía, para evitar necesitar aprobaciones adicionales de PayPal al
arrancar.

### Importante: esto es un negocio real si lo usás con dinero real

Si empezás a mover dinero de verdad (aunque sea en forma de "regalos"),
conviene que consultes con un contador sobre si tenés que declarar esos
ingresos como boleta o negocio — no es lo mismo tener un hobby que operar
algo con plata real entrando y saliendo.

## Sistema de cuentas (para evitar estafas)

Ya no alcanza con escribir un nombre: cada persona tiene que **crear una
cuenta con email y contraseña**. La contraseña se guarda encriptada
(nunca en texto plano), y el servidor verifica la identidad de cada
jugador con un token — así nadie puede hacerse pasar por otra persona
para robarle sus regalos o su plata.

### Una variable de entorno más que tenés que configurar

Además de las de PayPal, agregá esta en Render (o donde despliegues):
```
JWT_SECRET=una-clave-larga-y-aleatoria-que-solo-vos-conozcas
```
Si no la configurás, el servidor genera una al azar cada vez que arranca,
lo que **desconecta a todos los usuarios** cada vez que se reinicia el
servidor (no pierden sus cuentas ni sus gemas, solo tienen que volver a
iniciar sesión). Para producción de verdad, poné una fija.

Podés generar una clave así en tu compu:
```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Antes de publicar esto como app

Este proyecto en su estado actual guarda los datos en archivos simples
(`users.json`, `withdrawals.json`) en el mismo servidor. Funciona bien
para probar y para un grupo chico de usuarios, pero **antes de publicar
una app de verdad con mucha gente y plata real**, conviene:

- Pasar a una base de datos real (Postgres, MongoDB) en vez de archivos
- Agregar verificación de email al registrarse
- Agregar límites de intentos de login (para evitar ataques de fuerza bruta)
- Sumar HTTPS obligatorio (Render ya lo da gratis)
- Considerar un abogado para los términos de servicio y la política de
  privacidad, algo obligatorio si vas a publicar en tiendas de apps

## Tu panel de administrador

Andá a `tu-sitio.com/admin.html` (o `localhost:3000/admin.html` en tu compu)
para ver:
- Todos los pedidos de retiro pendientes, con un botón para marcarlos como
  pagados una vez que le mandaste la plata a la persona por PayPal
- Todos los usuarios registrados y cuántas gemas tiene cada uno
- Las salas de juego activas en este momento, con espectadores incluidos

### Configurar tu contraseña de administrador

Agregá esta variable de entorno (junto a las de PayPal y JWT):
```
ADMIN_PASSWORD=una-contraseña-que-solo-vos-conozcas
```
Si no la configurás, la contraseña por defecto es `cambiame123` — **cambiala
antes de publicar el sitio**, cualquiera que la sepa podría ver los datos
de tus usuarios.

## Sistema de monetización (verificación con documento + 1000 seguidores)

Cuando un usuario llega a 1000 seguidores, puede subir una foto de su
documento de identidad para solicitar la monetización de su cuenta. Vos,
como admin, revisás el documento desde el panel (`/admin.html`) y aprobás
o rechazás la solicitud.

### ⚠️ Muy importante: estás manejando datos súper sensibles

A partir de ahora tu sistema guarda **documentos de identidad y datos
bancarios**. Esto no es como guardar un nombre de usuario — es información
que, si se filtra, puede arruinarle la vida a alguien (robo de identidad,
fraude bancario). Antes de usar esto con gente real, tenés que:

1. **Nunca subir la carpeta `uploads_privados/` a GitHub** — ya está
   excluida en las instrucciones de despliegue, pero prestale atención
   especial. Si la subís a un repositorio público, cualquiera podría ver
   los documentos de identidad de tus usuarios.
2. **Contratar o consultar con alguien que sepa de seguridad informática**
   antes de manejar esto a gran escala. Guardar estos archivos sueltos en
   el disco del servidor (como hace este prototipo) no es suficiente para
   producción real — necesitás cifrado, backups seguros, y control de
   acceso serio.
3. **Revisar las leyes de protección de datos de tu país** (en Chile, la
   Ley 19.628 y sus actualizaciones) — manejar documentos de identidad
   tiene requisitos legales específicos que no podés ignorar.
4. Considerar usar un servicio especializado de verificación de identidad
   (como Persona, Onfido, o similar) en vez de guardar los documentos vos
   mismo — ellos ya cumplen con todos los estándares de seguridad
   necesarios, y vos solo recibís un "sí" o "no" de si la persona es quien
   dice ser.

## Confirmación de email real

Cuando alguien se registra, le mandamos un código de 6 dígitos a su correo.
Hasta que lo confirme, **no puede retirar plata ni pedir monetización**
(sí puede jugar normalmente mientras tanto).

### Cómo activar el envío de correos de verdad

Sin configurar esto, el código aparece en la consola del servidor (sirve
para probar, pero nadie más lo recibe). Para mandarlo de verdad:

1. Usá una cuenta de Gmail (puede ser una nueva, dedicada a esto)
2. Andá a https://myaccount.google.com/apppasswords y generá una
   "contraseña de aplicación" (necesitás tener la verificación en dos
   pasos activada en esa cuenta de Gmail primero)
3. Agregá estas variables de entorno (junto a las demás) en Render:
   ```
   EMAIL_USER=tu-cuenta@gmail.com
   EMAIL_PASS=la-contraseña-de-aplicación-de-16-caracteres
   ```

## Botón de compartir

En la pantalla de juego hay un botón "🔗 Compartir" (arriba, y también en
la barra de íconos a la derecha, estilo TikTok). En el celular abre el
menú nativo para mandarlo por WhatsApp, Instagram, etc. En la compu, copia
el link al portapapeles.

## Qué es prototipo todavía

- No hay sistema de puntaje acumulado entre partidas
- No hay reconexión automática si alguien cierra el navegador sin querer
  (tendría que volver a entrar con el mismo código, pero pierde su mano)
- El video usa la infraestructura pública gratuita de Jitsi; para volumen
  alto de uso simultáneo convendría un servidor de Jitsi propio
