import os
from pathlib import Path
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from dotenv import load_dotenv

from langchain_community.document_loaders import TextLoader
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_community.vectorstores import FAISS
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_groq import ChatGroq
from langchain.chains import create_retrieval_chain, create_history_aware_retriever
from langchain.chains.combine_documents import create_stuff_documents_chain
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.messages import HumanMessage, AIMessage

# Load environment variables (for GROQ_API_KEY)
load_dotenv()

app = FastAPI()

# Global variables for RAG state
rag_chain = None
chat_history = []

def init_rag():
    global rag_chain
    # 1. LOAD EMBEDDING MODEL
    embeddings = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")

    # 2. INPUT TEXT
    NOTEBOOK_PATH = Path("notebook.txt")
    DEFAULT_TEXT = """
Machine learning is a subset of artificial intelligence.
It focuses on learning from data.
Neural networks are widely used in deep learning.
Deep learning uses multi-layered neural networks to learn complex patterns.
Football is a popular sport played worldwide.
"""

    if not NOTEBOOK_PATH.exists():
        NOTEBOOK_PATH.write_text(DEFAULT_TEXT, encoding="utf-8")
        
    loader = TextLoader(str(NOTEBOOK_PATH), encoding="utf-8")
    docs = loader.load()

    # 3. CHUNKING
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=500,
        chunk_overlap=100,
        separators=["\n\n", "\n", ".", " ", ""]
    )
    splits = splitter.split_documents(docs)

    # 4. EMBED ALL CHUNKS AND CREATE VECTOR STORE
    vectorstore = FAISS.from_documents(documents=splits, embedding=embeddings)
    retriever = vectorstore.as_retriever(search_kwargs={"k": 2})

    # 5. INITIALIZE LLM (Using Groq)
    # Defaulting to llama3-8b-8192 for fast, high-quality responses
    llm = ChatGroq(model="llama3-8b-8192", temperature=0)

    # 6. SET UP CHAINS (WITH MEMORY)
    contextualize_q_system_prompt = """Given a chat history and the latest user question \
which might reference context in the chat history, formulate a standalone question \
which can be understood without the chat history. Do NOT answer the question, \
just reformulate it if needed and otherwise return it as is."""

    contextualize_q_prompt = ChatPromptTemplate.from_messages(
        [
            ("system", contextualize_q_system_prompt),
            MessagesPlaceholder("chat_history"),
            ("human", "{input}"),
        ]
    )
    history_aware_retriever = create_history_aware_retriever(
        llm, retriever, contextualize_q_prompt
    )

    qa_system_prompt = """You are a document assistant. Answer ONLY using the sources provided below.
If the answer is not found in the sources, reply with exactly: I don't have enough information.
Do not use outside knowledge.
Do not guess.
Do not explain why the information is missing.
If you answer from the sources, keep the answer concise.

SOURCES:
{context}"""

    qa_prompt = ChatPromptTemplate.from_messages(
        [
            ("system", qa_system_prompt),
            MessagesPlaceholder("chat_history"),
            ("human", "{input}"),
        ]
    )

    question_answer_chain = create_stuff_documents_chain(llm, qa_prompt)

    # Combine into a full RAG chain
    rag_chain = create_retrieval_chain(history_aware_retriever, question_answer_chain)

# Initialize the RAG pipeline when the app starts
init_rag()

class ChatRequest(BaseModel):
    query: str

@app.post("/api/chat")
async def chat_endpoint(request: ChatRequest):
    async def generate():
        response_content = ""
        # Stream the response
        for chunk in rag_chain.stream({"input": request.query, "chat_history": chat_history}):
            if "answer" in chunk:
                yield chunk["answer"]
                response_content += chunk["answer"]
        
        # Update history
        chat_history.extend([
            HumanMessage(content=request.query),
            AIMessage(content=response_content)
        ])
    
    return StreamingResponse(generate(), media_type="text/plain")

@app.post("/api/clear")
async def clear_history():
    global chat_history
    chat_history.clear()
    return {"status": "cleared"}

# Mount the static directory to serve HTML/CSS/JS
os.makedirs("static", exist_ok=True)
app.mount("/", StaticFiles(directory="static", html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
