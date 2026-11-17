import { StateGraph, START, END, MessagesValue, StateSchema, MemorySaver } from "@langchain/langgraph";
import { HumanMessage } from "@langchain/core/messages";
import { ChatGroq } from "@langchain/groq";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import readline from "readline";
import "dotenv/config";

const MiEstado = new StateSchema({ messages: MessagesValue });

const sumar = tool(
    ({ a, b }) => {
        console.log(`\n   [⚙️ Sistema: Calculando ${a} + ${b}...]`);
        return String(a + b);
    },
    { name: "sumar", description: "Suma dos números", schema: z.object({ a: z.number(), b: z.number() }) }
);

const ia = new ChatGroq({ model: "openai/gpt-oss-20b", temperature: 0 }).bindTools([sumar]);

async function nodoIA(estado) {
    return { messages: [await ia.invoke(estado.messages)] };
}
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
// BUCLE DE CHAT EN CONSOLA
// ==========================================
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const config = { configurable: { thread_id: "clase_1" } };

console.log("=========================================");
console.log("🤖 Chatbot con LangGraph iniciado (Escribe 'salir' para terminar)");
console.log("=========================================\n");

function iniciarChat() {
    rl.question("👤 Tú: ", async (texto) => {
        if (texto.toLowerCase() === "salir") {
            console.log("👋 ¡Adiós!");
            return rl.close();
        }

        try {
            const resultado = await grafo.invoke({ messages: [new HumanMessage(texto)] }, config);
            const respuestaIA = resultado.messages[resultado.messages.length - 1].content;
            console.log(`🤖 IA: ${respuestaIA}\n`);
        } catch (error) {
            console.error("Error:", error.message);
        }

        iniciarChat();
    });
}
iniciarChat();