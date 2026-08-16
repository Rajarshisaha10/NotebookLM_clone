import os
import shutil
import warnings
from pathlib import Path
from contextlib import asynccontextmanager
from fastapi import FastAPI, UploadFile, File
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from dotenv import load_dotenv

# Suppress deprecation warnings from langchain_community
warnings.filterwarnings("ignore", category=DeprecationWarning)

from langchain_community.document_loaders import TextLoader, PyPDFLoader
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_community.vectorstores import FAISS
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_groq import ChatGroq
from langchain_classic.chains import create_retrieval_chain, create_history_aware_retriever
from langchain_classic.chains.combine_documents import create_stuff_documents_chain
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.messages import HumanMessage, AIMessage

# Load environment variables
load_dotenv()

# Global variables for RAG state
rag_chain = None
question_answer_chain = None
chat_history = []
embeddings_instance = None
vectorstore = None

def get_embeddings():
    global embeddings_instance
    if embeddings_instance is None:
        print("[NotebookLM] Loading HuggingFace embeddings model (all-MiniLM-L6-v2)...")
        embeddings_instance = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")
    return embeddings_instance

@asynccontextmanager
async def lifespan(app: FastAPI):
    print("[NotebookLM] Initializing RAG pipeline...")
    init_rag()
    print("[NotebookLM] Server ready!")
    yield

app = FastAPI(lifespan=lifespan)

# Ensure data directory exists
DATA_DIR = Path("data")
DATA_DIR.mkdir(exist_ok=True)

# Create a default text file if data directory is empty
if not any(DATA_DIR.iterdir()):
    default_text = """
Machine learning is a subset of artificial intelligence.
It focuses on learning from data.
Neural networks are widely used in deep learning.
Deep learning uses multi-layered neural networks to learn complex patterns.
Football is a popular sport played worldwide.
"""
    (DATA_DIR / "notebook.txt").write_text(default_text, encoding="utf-8")

def get_document_splits():
    docs = []
    # Load all files in the data directory
    for file_path in DATA_DIR.iterdir():
        if file_path.is_file() and file_path.name != "notes.json":
            if file_path.suffix.lower() == ".pdf":
                loader = PyPDFLoader(str(file_path))
                docs.extend(loader.load())
            elif file_path.suffix.lower() == ".txt":
                loader = TextLoader(str(file_path), encoding="utf-8")
                docs.extend(loader.load())

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=500,
        chunk_overlap=100,
        separators=["\n\n", "\n", ".", " ", ""]
    )
    splits = splitter.split_documents(docs)
    return splits

def init_rag():
    global rag_chain, question_answer_chain, vectorstore
    splits = get_document_splits()
    
    emb = get_embeddings()
    # Re-create vector store
    vectorstore = FAISS.from_documents(documents=splits, embedding=emb)
    retriever = vectorstore.as_retriever(search_kwargs={"k": 3})

    llm = ChatGroq(model=os.getenv("GROQ_MODEL", "llama-3.1-8b-instant"), temperature=0)

    # SET UP CHAINS (WITH MEMORY)
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
    rag_chain = create_retrieval_chain(history_aware_retriever, question_answer_chain)

class ChatRequest(BaseModel):
    query: str

@app.post("/api/chat")
async def chat_endpoint(request: ChatRequest):
    if rag_chain is None or vectorstore is None:
        init_rag()

    async def generate():
        response_content = ""
        try:
            if chat_history:
                stream_iter = rag_chain.stream({"input": request.query, "chat_history": chat_history})
                for chunk in stream_iter:
                    if isinstance(chunk, dict) and "answer" in chunk:
                        text = chunk["answer"]
                        yield text
                        response_content += text
            else:
                docs = vectorstore.similarity_search(request.query, k=3)
                stream_iter = question_answer_chain.stream({
                    "input": request.query,
                    "context": docs,
                    "chat_history": []
                })
                for chunk in stream_iter:
                    text = chunk if isinstance(chunk, str) else str(chunk)
                    if text:
                        yield text
                        response_content += text

            if response_content:
                chat_history.extend([
                    HumanMessage(content=request.query),
                    AIMessage(content=response_content)
                ])
        except Exception as e:
            print(f"[ERROR in /api/chat]: {e}")
            yield f"⚠️ Error generating response: {str(e)}"
    
    return StreamingResponse(generate(), media_type="text/plain")

@app.post("/api/clear")
async def clear_history():
    global chat_history
    chat_history.clear()
    return {"status": "cleared"}

@app.post("/api/upload")
async def upload_document(file: UploadFile = File(...)):
    if not file.filename.lower().endswith(('.pdf', '.txt')):
        return {"error": "Only PDF and TXT files are supported"}
        
    file_path = DATA_DIR / file.filename
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    # Re-initialize the RAG system to include the new document
    init_rag()
    
    return {"status": "success", "filename": file.filename}

@app.get("/api/documents")
async def get_documents():
    docs = [f.name for f in DATA_DIR.iterdir() if f.is_file() and f.name != "notes.json"]
    return {"documents": docs}

# --- Short Note Cards Management ---
import json
import uuid
from datetime import datetime

NOTES_FILE = DATA_DIR / "notes.json"
if not NOTES_FILE.exists():
    NOTES_FILE.write_text("[]", encoding="utf-8")

def read_notes():
    try:
        if NOTES_FILE.exists():
            return json.loads(NOTES_FILE.read_text(encoding="utf-8"))
    except Exception:
        pass
    return []

def write_notes(notes):
    NOTES_FILE.write_text(json.dumps(notes, indent=2), encoding="utf-8")

class NoteItem(BaseModel):
    id: str | None = None
    title: str
    content: str
    tags: list[str] = []
    source_doc: str | None = None
    timestamp: str | None = None
    pinned: bool = False

@app.get("/api/notes")
async def get_notes():
    return {"notes": read_notes()}

@app.post("/api/notes")
async def create_note(note: NoteItem):
    notes = read_notes()
    new_note = note.model_dump()
    if not new_note.get("id"):
        new_note["id"] = uuid.uuid4().hex[:8]
    if not new_note.get("timestamp"):
        new_note["timestamp"] = datetime.now().strftime("%b %d, %H:%M")
    
    notes.insert(0, new_note)
    write_notes(notes)
    return {"status": "success", "note": new_note}

@app.put("/api/notes/{note_id}")
async def update_note(note_id: str, note_data: NoteItem):
    notes = read_notes()
    updated = None
    for idx, n in enumerate(notes):
        if n["id"] == note_id:
            updated = note_data.model_dump()
            updated["id"] = note_id
            if not updated.get("timestamp"):
                updated["timestamp"] = n.get("timestamp")
            notes[idx] = updated
            break
    if updated:
        write_notes(notes)
        return {"status": "success", "note": updated}
    return {"error": "Note not found"}, 404

@app.delete("/api/notes/{note_id}")
async def delete_note(note_id: str):
    notes = read_notes()
    notes = [n for n in notes if n["id"] != note_id]
    write_notes(notes)
    return {"status": "success", "id": note_id}

# Mount the static directory to serve HTML/CSS/JS
os.makedirs("static", exist_ok=True)
app.mount("/", StaticFiles(directory="static", html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    print(f"Server starting at http://127.0.0.1:{port}/")
    uvicorn.run("main:app", host="127.0.0.1", port=port, reload=True)
