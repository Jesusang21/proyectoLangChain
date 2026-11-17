import { StateGraph, START, END, MessagesValue, StateSchema, MemorySaver } from "@langchain/langgraph";
import { HumanMessage } from "@langchain/core/messages";
import { ChatGroq } from "@langchain/groq";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { WebSocketServer } from "ws"; // ⬅️ CAMBIO 1: Importamos WebSockets en lugar de readline
import "dotenv/config";

const MiEstado = new StateSchema({ messages: MessagesValue });

const sumar = tool(
    ({ a, b }) => {
        console.log(`[⚙️ Calculando ${a} + ${b}...]`);
        return String(a + b);
    },
    { name: "sumar", description: "Suma dos números", schema: z.object({ a: z.number(), b: z.number() }) }
);

const ia = new ChatGroq({ model: "openai/gpt-oss-20b", temperature: 0 }).bindTools([sumar]);

async function nodoIA(estado) { return { messages: [await ia.invoke(estado.messages)] }; }
async function nodoHerramientas(estado) {
    const ultimoMensaje = estado.messages[estado.messages.length - 1];
    const resultados = [];
    for (const peticion of ultimoMensaje.tool_calls || []) {
        if (peticion.name === "sumar") resultados.push(await sumar.invoke(peticion));
    }
    return { messages: resultados };
}
function decidirCamino(estado) {
    const ultimoMensaje = estado.messages[estado.messages.length - 1];
    if (ultimoMensaje.tool_calls && ultimoMensaje.tool_calls.length > 0) return "herramientas";
    return END;
}

const memoria = new MemorySaver();
const grafo = new StateGraph(MiEstado)
    .addNode("ia", nodoIA)
    .addNode("herramientas", nodoHerramientas)
    .addEdge(START, "ia")
    .addConditionalEdges("ia", decidirCamino, ["herramientas", END])
    .addEdge("herramientas", "ia")
    .compile({ checkpointer: memoria });

// ==========================================
// 6. SERVIDOR WEBSOCKET (Sustituye a readline)
// ==========================================
const wss = new WebSocketServer({ port: 8080 }); // Abrimos el puerto 8080

console.log("=========================================");
console.log("🌐 Servidor LangGraph escuchando en ws://localhost:8080");
console.log("=========================================\n");

// Cuando un cliente (una web) se conecta...
wss.on("connection", (ws) => {
    console.log("🟢 Nuevo cliente conectado.");
    ws.send("¡Hola! Soy tu asistente de IA. ¿En qué te ayudo?"); // Mensaje de bienvenida

    // Cuando el cliente envía un mensaje...
    ws.on("message", async (mensaje) => {
        const textoUsuario = mensaje.toString();
        console.log(`👤 Usuario dice: ${textoUsuario}`);

        try {
            // Usamos un thread_id único para este cliente
            const config = { configurable: { thread_id: "cliente_web_1" } };

            // Ejecutamos el gráfico
            const resultado = await grafo.invoke({ messages: [new HumanMessage(textoUsuario)] }, config);
            const respuestaIA = resultado.messages[resultado.messages.length - 1].content;

            // Enviamos la respuesta de vuelta a la página web
            ws.send(respuestaIA);

        } catch (error) {
            console.error("Error:", error.message);
            ws.send("Hubo un error al procesar tu mensaje.");
        }
    });

    ws.on("close", () => console.log("🔴 Cliente desconectado."));
});