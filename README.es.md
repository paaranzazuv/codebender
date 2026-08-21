<p align="center">
  <img src="media/icon.png" alt="CodeBender" width="112" />
</p>

<h1 align="center">CodeBender</h1>

<p align="center">
  <strong>Revisión de código human-in-the-loop para agentes de programación con IA, directamente dentro de VS Code.</strong>
</p>

<p align="center">
  Revisa las ediciones generadas por IA como bloques inline independientes. Acepta, rechaza, lleva a staging o devuelve un bloque puntual al agente sin perder el control del resto del archivo.
</p>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.es.md"><strong>Español</strong></a> ·
  <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <img alt="VS Code" src="https://img.shields.io/badge/VS%20Code-%5E1.85.0-007ACC?logo=visualstudiocode&logoColor=white" />
  <img alt="Version" src="https://img.shields.io/badge/version-0.7.6-4C8BF5" />
  <img alt="License" src="https://img.shields.io/badge/license-MIT-green" />
  <img alt="Git-first" src="https://img.shields.io/badge/baseline-Git--first-F05032?logo=git&logoColor=white" />
  <img alt="Provider neutral" src="https://img.shields.io/badge/agents-provider--neutral-7B61FF" />
</p>

---

## Por qué CodeBender

Los agentes de programación con IA pueden modificar una base de código más rápido de lo que una persona puede revisar cómodamente. El problema no es generar código — es conservar **control humano preciso sobre lo que realmente se queda**.

CodeBender agrega una capa de revisión entre un agente de IA y tu workspace:

```text
Agente de programación con IA
      ↓
modifica archivos del workspace
      ↓
CodeBender detecta solo los cambios nuevos de la sesión
      ↓
┌──────────────────────────────────────────────┐
│ Bloque 1                                     │
│ ✓ Aceptar  ⎇ Aceptar + Stage  ↶ Rechazar    │
│ 💬 Solicitar corrección                      │
└──────────────────────────────────────────────┘
      ↓
┌──────────────────────────────────────────────┐
│ Bloque 2                                     │
│ ✓ Aceptar  ⎇ Aceptar + Stage  ↶ Rechazar    │
│ 💬 Solicitar corrección                      │
└──────────────────────────────────────────────┘
      ↓
resultado controlado por una persona
```

Un archivo con tres ediciones independientes sigue siendo **tres decisiones de revisión independientes**.

CodeBender está diseñado para sentirse cercano al flujo de revisión por bloques popularizado por los asistentes de programación con IA, manteniéndose **neutral respecto del proveedor** y construido sobre APIs públicas de extensiones de VS Code.

---

## Lo más destacado

### Revisa los cambios bloque por bloque

Cada hunk nuevo puede revisarse directamente en el archivo fuente original:

- **Aceptar** — conserva únicamente el bloque seleccionado.
- **Aceptar + Stage** — acepta y lleva a staging únicamente ese bloque.
- **Rechazar** — restaura únicamente ese bloque al baseline de la sesión.
- **Solicitar corrección** — devuelve únicamente ese bloque, su contexto y tu instrucción al agente de programación seleccionado.

Aceptar un bloque no acepta automáticamente el resto del archivo.

### Acciones masivas sin abrir el archivo

La vista **Review Changes** también expone atajos opcionales a nivel de archivo:

```text
src/auth.ts                         ✓   ↶
src/api/users.ts                    ✓   ↶
src/components/Login.tsx            ✓   ↶
```

- `✓` **Aceptar todos los cambios del archivo**
- `↶` **Rechazar todos los cambios del archivo**

Son acciones masivas explícitas. La revisión inline sigue siendo por bloque.

### Arranque Git-first

Para repositorios Git, CodeBender evita copiar todo el proyecto antes de que empiece una sesión.

```text
Iniciar sesión de revisión
        ↓
repositorio Git detectado
        ↓
¿árbol limpio? ── sí ──→ reutiliza HEAD como baseline
        │
        no
        ↓
captura el estado inicial exacto con un índice Git aislado
        ↓
listo
```

El contenido original se carga de forma perezosa, solo para los archivos que resultan relevantes para la revisión.

### Revisión solo de cambios nuevos

El baseline de la sesión se congela al presionar **Iniciar sesión de revisión**.

Abrir, activar, cambiar a, o simplemente ver un archivo **no** crea acciones de revisión. CodeBender solo decora los cambios que aparecen después de iniciar la sesión.

### Staging parcial seguro

`Aceptar + Stage` opera sobre el hunk seleccionado en lugar de llevar a staging el archivo completo. El trabajo ya staged se conserva cuando el bloque seleccionado puede aplicarse de forma segura.

Si CodeBender detecta un solape inseguro, se detiene antes de modificar el índice Git.

### Devuelve un bloque al agente

`Solicitar corrección` envía un único mensaje estructurado que contiene:

- tu instrucción primero;
- el archivo y el bloque seleccionados;
- el código modificado;
- contexto mínimo alrededor;
- reglas explícitas para no reescribir otros bloques pendientes.

Los prompts multilínea se envían como una sola entrada de terminal usando semántica de bracketed paste.

---

## Agentes de programación soportados

CodeBender es neutral respecto del proveedor. Los adaptadores de terminal incluidos soportan:

| Agente | Comando por defecto |
|---|---|
| Claude Code | `claude` |
| OpenAI Codex | `codex` |
| Kimi Code | `kimi` |
| Gemini CLI | `gemini` |
| OpenCode | `opencode` |
| Terminal activa | Terminal de VS Code existente |
| CLI personalizada | Adaptador configurable |

CodeBender no requiere una API key para estas integraciones. Habla con el agente a través del flujo de terminal local que ya usas.

---

## Instalación

### Instalar desde VSIX

1. Descarga `codebender-0.7.6.vsix`.
2. Abre VS Code.
3. Presiona `Ctrl+Shift+P` / `Cmd+Shift+P`.
4. Ejecuta **Extensions: Install from VSIX...**.
5. Selecciona el archivo descargado.
6. Ejecuta **Developer: Reload Window** si VS Code no se recarga automáticamente.

### Requisitos

- VS Code `1.85.0` o superior.
- Git es muy recomendable para el baseline rápido, el historial, los checkpoints y el staging parcial.
- Una CLI de agente de programación soportada es opcional y solo se necesita para **Solicitar corrección**.

---

## Inicio rápido

### 1. Abre un proyecto

Abre la carpeta del proyecto — no solo un archivo individual.

### 2. Inicia una sesión de revisión

Ejecuta:

```text
CodeBender: Iniciar sesión de revisión
```

El estado actual del workspace se convierte en el baseline de la sesión.

### 3. Deja trabajar a tu agente de programación

Usa Claude Code, Codex, Kimi, Gemini CLI, OpenCode, otro agente de terminal, o edita manualmente.

### 4. Revisa solo los bloques nuevos

Dentro del archivo modificado:

```text
✓ Aceptar   ⎇ Aceptar + Stage   ↶ Rechazar   💬 Solicitar corrección
──────────────────────────────────────────────────────────────
bloque modificado
```

O usa la vista lateral **Review Changes** para aceptar/rechazar todos los bloques pendientes de un archivo sin abrirlo.

### 5. Continúa hasta que no queden cambios pendientes

Después puedes seguir trabajando, crear un checkpoint Git, inspeccionar el historial o finalizar la sesión.

---

## Modelo de revisión

### El baseline de la sesión

CodeBender siempre compara el trabajo nuevo contra el estado capturado cuando se inició la sesión de revisión.

Ese punto de partida puede contener ya:

- código commiteado;
- cambios sin stage;
- cambios ya en stage;
- buffers de editor abiertos con contenido sin guardar.

Esos estados preexistentes se tratan como **baseline**, no como cambios nuevos de IA.

### Aislamiento por bloque

Si un archivo contiene ediciones separadas:

```text
Bloque A   → pendiente
Bloque B   → pendiente
Bloque C   → pendiente
```

entonces:

```text
Aceptar A
Rechazar B
Aceptar + Stage C
```

produce tres decisiones independientes. CodeBender no las colapsa intencionalmente en una única decisión a nivel de archivo.

### Archivos eliminados

Un archivo eliminado por completo no tiene buffer de editor donde renderizar controles CodeLens. Por eso CodeBender representa una eliminación completa como un único bloque de eliminación en **Review Changes**, donde puede aceptarse, aceptarse + staged, o rechazarse.

---

## Vista Review Changes

La vista lateral busca responder dos preguntas rápidamente:

1. **¿Qué archivos todavía tienen bloques de revisión pendientes?**
2. **¿Quiero revisar este archivo bloque a bloque o decidir todos sus bloques restantes de una vez?**

Para un archivo modificado normal:

```text
src/services/user.ts       3 bloques        ✓   ↶
```

- Clic en el archivo → lo abre y revisa los bloques inline.
- Clic en `✓` → acepta todos los bloques pendientes de ese archivo.
- Clic en `↶` → rechaza todos los bloques pendientes de ese archivo.

Las acciones masivas afectan solo al archivo seleccionado.

---

## Experiencia inline en el editor

CodeBender usa decoraciones de VS Code, indicadores en el gutter y controles CodeLens para mantener las decisiones de revisión cerca del código modificado.

### Marcadores en el gutter

Los bloques pendientes reciben un indicador en el gutter para que las ubicaciones de revisión sigan siendo visibles mientras navegas el archivo.

### Navegación

| Acción | Windows / Linux | macOS |
|---|---|---|
| Siguiente cambio pendiente | `Alt+Shift+Down` | `Alt+Shift+Down` |
| Cambio pendiente anterior | `Alt+Shift+Up` | `Alt+Shift+Up` |
| Deshacer última decisión | `Ctrl+Alt+Z` | `Cmd+Alt+Z` |

### Insignias en el Explorer

Los archivos con trabajo de revisión pendiente pueden mostrar una insignia en el Explorer normal de VS Code.

Desactívala con:

```json
{
  "codeBender.explorer.badges": false
}
```

---

## Aceptar + Stage

`Aceptar + Stage` es intencionalmente distinto de `git add <file>`.

Está diseñado para llevar a staging **únicamente el bloque de revisión aceptado**.

Ejemplo:

```text
src/auth.ts

Bloque 1 → Aceptar + Stage
Bloque 2 → pendiente
Bloque 3 → pendiente
```

Estado Git esperado:

```text
STAGED
└── Bloque 1

WORKING TREE
├── Bloque 2
└── Bloque 3
```

### Seguridad del índice

CodeBender lee el índice Git actual, aplica el hunk de revisión seleccionado sobre ese contenido indexado, y escribe el índice actualizado solo cuando la operación no es ambigua.

Este diseño ayuda a conservar:

- trabajo staged que ya existía antes de CodeBender;
- otros bloques staged no relacionados;
- trabajo sin stage anterior a la sesión;
- bloques CodeBender pendientes en el mismo archivo.

---

## Baseline Git-first y versionamiento

CodeBender usa Git para dos propósitos separados.

### 1. Baseline de revisión y checkpoints

El estado interno de revisión puede representarse con objetos Git y refs internas sin mover tu rama.

Conceptualmente:

```text
refs/codebender/<sesión>/checkpoints/<id>
```

### 2. Staging explícito

Solo `Aceptar + Stage` actualiza intencionalmente el índice Git real.

### Repositorio limpio

Cuando es posible, CodeBender reutiliza `HEAD` directamente como baseline.

### Repositorio con trabajo local

Si el workspace ya contiene cambios sin commitear, CodeBender puede capturar el estado inicial exacto mediante un `GIT_INDEX_FILE` temporal aislado.

```text
índice Git real          → se conserva
índice temporal CodeBender → árbol/checkpoint de baseline
```

Esto evita que la creación del baseline reemplace tu área de staging.

---

## Workspaces sin Git

Git es recomendable pero no obligatorio.

Las carpetas fuera de Git usan el motor de snapshot de respaldo. CodeBender:

- excluye carpetas comunes de dependencias/build;
- limita el tamaño y la cantidad de archivos del snapshot;
- crea el almacenamiento de snapshots antes de que arranquen los workers concurrentes;
- evita la anterior condición de carrera `globalStorage/.../snapshots/... ENOENT`;
- conserva el estado inicial necesario para rechazar bloques.

Las exclusiones por defecto incluyen carpetas como `.git`, `node_modules`, `.next`, `dist`, `build`, `target`, `vendor`, entornos virtuales y salidas de cobertura.

---

## Solicitar corrección

Usa **Solicitar corrección** cuando un bloque generado está cerca, pero no lo suficientemente correcto para aceptarlo.

El mensaje por defecto enfoca al agente en el bloque pendiente seleccionado:

```text
Reviewer correction request

Instruction: <tu feedback>
File: <ruta relativa al workspace>
Pending block: <tipo y líneas actuales>

Rules:
- Correct only this pending CodeBender block.
- Do not modify unrelated pending blocks.
- Work on the real workspace file.
```

### Modos de contexto

```json
{
  "codeBender.agent.contextMode": "block+context",
  "codeBender.agent.contextLines": 40
}
```

Modos disponibles:

- `block` — solo el bloque seleccionado.
- `block+context` — el bloque seleccionado más líneas cercanas.
- `file` — el bloque más el contenido completo del archivo, sujeto a límites de tamaño.

Por seguridad, CodeBender no presiona Enter automáticamente salvo que lo habilites explícitamente.

---

## Controles de seguimiento

CodeBender puede pausar temporalmente el seguimiento cuando necesitas hacer ediciones manuales no relacionadas.

Comandos:

```text
CodeBender: Pausar seguimiento
CodeBender: Reanudar seguimiento
CodeBender: Pausar/Reanudar seguimiento
```

El comportamiento ante conflictos al reanudar se puede configurar con:

```json
{
  "codeBender.pause.conflictStrategy": "ask"
}
```

Valores:

- `ask`
- `keep-pending`
- `absorb-all`

---

## Configuración

Configuración inicial recomendada:

```json
{
  "codeBender.git.enabled": true,
  "codeBender.git.fastBaseline": true,
  "codeBender.git.checkpointOnDecision": false,
  "codeBender.inlineReview.enabled": true,
  "codeBender.inlineReview.showCodeLens": true,
  "codeBender.explorer.badges": true,
  "codeBender.agent.default": "ask",
  "codeBender.agent.autoCreateTerminal": false,
  "codeBender.agent.executePrompt": false,
  "codeBender.agent.contextMode": "block+context",
  "codeBender.agent.contextLines": 40
}
```

### Ajustes importantes

| Ajuste | Por defecto | Propósito |
|---|---:|---|
| `codeBender.git.enabled` | `true` | Habilita checkpoints Git e integración de staging. |
| `codeBender.git.fastBaseline` | `true` | Usa baselines de sesión respaldados por Git de forma perezosa. |
| `codeBender.git.checkpointOnDecision` | `false` | Evita crear un checkpoint Git tras cada acción de revisión. |
| `codeBender.inlineReview.enabled` | `true` | Habilita la revisión inline por bloque. |
| `codeBender.inlineReview.showCodeLens` | `true` | Muestra acciones sobre los bloques pendientes. |
| `codeBender.explorer.badges` | `true` | Muestra insignias de cambios pendientes en el Explorer. |
| `codeBender.confirmReject` | `true` | Confirma el rechazo destructivo de archivo/de todos los cambios. |
| `codeBender.agent.default` | `ask` | Elige el agente de programación destino. |
| `codeBender.agent.executePrompt` | `false` | Presiona Enter automáticamente tras insertar el feedback al agente. |
| `codeBender.agent.contextMode` | `block+context` | Cantidad de código enviada con el feedback de corrección. |
| `codeBender.maxFileSizeMB` | `10` | Tamaño máximo de archivo manejado por los snapshots de respaldo. |
| `codeBender.maxFiles` | `20000` | Cantidad máxima de archivos incluidos en sesiones de respaldo. |

Consulta `package.json` para el esquema de configuración completo.

---

## Comandos

Comandos principales disponibles desde la Command Palette:

| Comando | Propósito |
|---|---|
| `CodeBender: Iniciar sesión de revisión` | Congela el estado actual como baseline de revisión. |
| `CodeBender: Finalizar sesión` | Termina la sesión de revisión activa. |
| `CodeBender: Actualizar cambios` | Actualiza los cambios pendientes. |
| `CodeBender: Pausar seguimiento` | Detiene temporalmente el seguimiento de ediciones nuevas. |
| `CodeBender: Reanudar seguimiento` | Reanuda el seguimiento. |
| `CodeBender: Siguiente cambio` | Navega al siguiente bloque pendiente. |
| `CodeBender: Cambio anterior` | Navega al bloque pendiente anterior. |
| `CodeBender: Deshacer última decisión` | Deshace la última decisión de CodeBender. |
| `CodeBender: Ver resumen de sesión` | Muestra estadísticas de la sesión de revisión. |
| `CodeBender: Crear checkpoint Git` | Crea un checkpoint Git interno explícito. |
| `CodeBender: Ver historial Git` | Inspecciona el historial/checkpoints Git disponibles. |

Las acciones inline y del árbol lateral aportan los comandos específicos por bloque/archivo.

---

## Modelo de rendimiento

### Enfoque anterior de snapshot completo

Un repositorio grande podía requerir:

```text
buscar archivos
  + hacer stat de archivos
  + leer archivos
  + hashear archivos
  + escribir copias de snapshot
  + crear checkpoint Git
```

### Enfoque actual Git-first

Para un repositorio Git limpio:

```text
git status
   ↓
baseline HEAD
   ↓
listo
```

Si solo cuatro archivos cambian en un repositorio de 10.000 archivos, CodeBender puede enfocar el trabajo de revisión en esos archivos en lugar de duplicar todo el workspace primero.

---

## Fin de línea y codificación

CodeBender normaliza la semántica de comparación para que diferencias ordinarias de `LF` frente a `CRLF` no creen bloques de revisión fantasma de archivo completo.

El motor de revisión también evita tratar una diferencia de BOM UTF-8 como un cambio de código.

Abrir un archivo CRLF cuyo baseline Git sea LF debería producir por lo tanto **cero bloques de revisión** hasta que ocurran cambios reales de contenido.

---

## Principios de seguridad

CodeBender es intencionalmente conservador con las operaciones destructivas.

### No necesita

- ejecutar `git reset --hard` para iniciar una sesión;
- ejecutar `git clean` para gestionar el estado de revisión;
- cambiar de rama para los checkpoints internos;
- reemplazar tu índice Git real solo para crear un baseline;
- aceptar un archivo completo cuando eliges una acción de bloque inline.

### Antes de un rechazo masivo destructivo

El rechazo a nivel de archivo puede configurarse para requerir confirmación:

```json
{
  "codeBender.confirmReject": true
}
```

### Prompts al agente

CodeBender inserta los prompts de corrección en terminales locales. La ejecución automática está deshabilitada por defecto:

```json
{
  "codeBender.agent.executePrompt": false
}
```

Esto te da la oportunidad de revisar el mensaje antes de enviarlo.

---

## Arquitectura

```text
┌───────────────────────────────────────────────────────┐
│                       VS Code                         │
│                                                       │
│  Workspace ── File watchers ── Compuerta de revisión  │
│      │                               │                │
│      │                               ▼                │
│      │                         Motor de hunks          │
│      │                               │                │
│      │                  ┌────────────┴────────────┐   │
│      │                  │                         │   │
│      ▼                  ▼                         ▼   │
│ Baseline Git       Revisión inline           Vista de │
│ / snapshots        + CodeLens                árbol    │
│      │                  │                         │   │
│      └──────────────┬───┴──────────────┬─────────┘   │
│                     │                  │             │
│              Staging Git         Feedback al agente  │
│                     │                  │             │
│                     ▼                  ▼             │
│                Índice Git         Terminal local     │
└───────────────────────────────────────────────────────┘
```

Módulos principales:

| Módulo | Responsabilidad |
|---|---|
| `extension.js` | Ciclo de vida de VS Code, comandos, vistas, decoraciones, orquestación de sesión. |
| `hunks.js` | Detección de bloques y operaciones a nivel de hunk. |
| `review-state.js` | Compuerta de revisión solo-cambios-nuevos y estado de revisión de la sesión. |
| `git-versioning.js` | Baselines Git-first, checkpoints, historial. |
| `git-staging.js` | Staging parcial seguro de los hunks aceptados. |
| `agent-send.js` | Selección de agente, construcción del prompt de corrección, transporte a terminal. |
| `tracking-pause.js` | Comportamiento de pausa/reanudación y manejo de conflictos. |

Más detalle disponible en [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Pruebas

Desde el directorio fuente:

```bash
npm test
npm run check
```

La suite de regresión cubre las rutas críticas de revisión, incluyendo:

- hunks independientes en el mismo archivo;
- aceptar y rechazar a nivel de hunk;
- `Aceptar + Stage` parcial;
- conservación de trabajo staged/unstaged preexistente;
- inserciones y eliminaciones;
- manejo de LF/CRLF;
- manejo de BOM;
- compuerta de revisión solo-cambios-nuevos;
- transporte de prompts al agente;
- acciones masivas de aceptar/rechazar a nivel de archivo.

---

## Solución de problemas

### Abrir un archivo muestra cambios aunque no lo edité

Asegúrate de estar usando una build que incluya la compuerta solo-cambios-nuevos y la normalización de EOL. Las builds actuales garantizan que simplemente abrir o activar un archivo no crea acciones de revisión.

Si el problema persiste, revisa transformaciones específicas del repositorio como `.gitattributes`, extensiones de formato al abrir/guardar, archivos generados o codificaciones no estándar.

### `Aceptar + Stage` falla

CodeBender aborta intencionalmente si el hunk seleccionado no puede aplicarse de forma segura al índice Git actual. Verifica si esas mismas líneas ya contienen cambios staged o previos a la sesión.

### `Solicitar corrección` aparece como varios mensajes de terminal

Desde 0.7.4 se usa transporte por bracketed paste para prompts multilínea. Confirma que estás usando la build actual y que la terminal destino soporta el comportamiento estándar de bracketed paste.

### Error de arranque de snapshot: `ENOENT ... globalStorage/.../snapshots`

Las builds actuales crean los directorios de snapshot antes de que arranquen los workers concurrentes de respaldo. Recarga VS Code tras actualizar desde una build antigua.

### No aparecen controles inline

Revisa:

```json
{
  "codeBender.inlineReview.enabled": true,
  "codeBender.inlineReview.showCodeLens": true
}
```

Confirma también que haya una sesión de revisión activa y que la edición haya ocurrido después de iniciar la sesión.

---

## Estado del proyecto

CodeBender está en desarrollo activo. El diseño actual se enfoca en una semántica de revisión local confiable antes de agregar automatización más amplia.

### Prioridades actuales

- hacer la identidad de los hunks más resiliente cuando los agentes editan repetidamente la misma región;
- mejorar la paridad visual con las experiencias nativas de revisión de ediciones de IA;
- reforzar el comportamiento en workspaces multi-root;
- mejorar la atribución de agentes y las estadísticas de sesión;
- añadir una UX más rica de checkpoints/historial Git;
- ampliar la cobertura de pruebas de integración automatizadas dentro de un VS Code Extension Host real.

---

## Contribuir

Se aceptan contribuciones, reportes de bugs, casos límite reproducibles y propuestas de diseño.

Antes de abrir un pull request, lee [`CONTRIBUTING.md`](CONTRIBUTING.md).

Los reportes útiles incluyen:

- versión de VS Code;
- sistema operativo;
- versión de Git;
- si el repositorio estaba limpio o sucio al iniciar la sesión;
- configuración de fin de línea (`.gitattributes`, `core.autocrlf`);
- acción exacta de CodeBender utilizada;
- pasos mínimos de reproducción.

---

## Seguridad

Por favor no publiques detalles sensibles de vulnerabilidades en un issue público. Consulta [`SECURITY.md`](SECURITY.md) para el proceso de seguridad del proyecto.

---

## Licencia

CodeBender se distribuye bajo la [Licencia MIT](LICENSE).

---

<p align="center">
  <strong>Conserva la velocidad de los agentes de programación con IA. Conserva la decisión final humana.</strong>
</p>
