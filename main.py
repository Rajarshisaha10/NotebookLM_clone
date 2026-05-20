from pathlib import Path
from sentence_transformers import SentenceTransformer, util
from langchain_text_splitters import RecursiveCharacterTextSplitter
import ollama

# 1. LOAD EMBEDDING MODEL
embedder = SentenceTransformer('all-MiniLM-L6-v2')

# 2. INPUT TEXT (your "notebook")
NOTEBOOK_PATH = Path("notebook.txt")
DEFAULT_TEXT = """
Machine learning is a subset of artificial intelligence.
It focuses on learning from data.
Neural networks are widely used in deep learning.
Deep learning uses multi-layered neural networks to learn complex patterns.
Football is a popular sport played worldwide.
"""

if NOTEBOOK_PATH.exists():
    text = NOTEBOOK_PATH.read_text(encoding="utf-8")
else:
    text = DEFAULT_TEXT

# 3. CHUNKING
splitter = RecursiveCharacterTextSplitter(
    chunk_size=500,
    chunk_overlap=100,
    separators=["\n\n", "\n", ".", " ", ""]
)
chunks = splitter.split_text(text)

# 4. EMBED ALL CHUNKS
chunk_embeddings = embedder.encode(chunks, normalize_embeddings=True)

SUMMARY_KEYWORDS = {
    "summarize",
    "summary",
    "summarise",
    "overview",
    "brief",
    "gist",
}

# 5. RETRIEVAL FUNCTION
def retrieve(query: str, top_k: int = 2) -> list[str]:
    query_embedding = embedder.encode(query, normalize_embeddings=True)
    scores = util.cos_sim(query_embedding, chunk_embeddings)[0]

    ranked = sorted(
        zip(scores.tolist(), chunks),
        key=lambda x: x[0],
        reverse=True
    )

    return [chunk for _, chunk in ranked[:top_k]]


def is_summary_query(query: str) -> bool:
    lowered_query = query.lower()
    return any(keyword in lowered_query for keyword in SUMMARY_KEYWORDS)

# 6. STREAMING FUNCTION
def ask_streaming(query: str, model: str = "phi3"):
    relevant_chunks = chunks if is_summary_query(query) else retrieve(query)

    context = "\n\n".join(
        [f"[Source {i+1}] {chunk}" for i, chunk in enumerate(relevant_chunks)]
    )

    prompt = f"""<|system|>
You are a document assistant. Answer ONLY using the sources provided.
If the answer is not found in the sources, reply with exactly: I don't have enough information.
Do not use outside knowledge.
Do not guess.
Do not explain why the information is missing.
If you answer from the sources, keep the answer concise and cite [Source N].<|end|>
<|user|>
SOURCES:
{context}

QUESTION: {query}<|end|>
<|assistant|>"""

    print(f"\n🤖 Answer:\n")
    stream = ollama.chat(
        model=model,
        messages=[{"role": "user", "content": prompt}],
        stream=True
    )

    for chunk in stream:
        print(chunk['message']['content'], end='', flush=True)
    print("\n")

# 7. INTERACTIVE CHAT LOOP
if __name__ == "__main__":
    print("=" * 50)
    print("📖 NotebookLM — Powered by Phi-3")
    print("Type your question below. Type 'exit' or 'quit' to stop.")
    print("=" * 50)

    while True:
        try:
            query = input("\n❓ You: ").strip()

            if not query:
                print("⚠️  Please enter a question.")
                continue

            if query.lower() in ("exit", "quit"):
                print("\n👋 Goodbye!")
                break

            ask_streaming(query, model="phi3")

        except KeyboardInterrupt:
            print("\n\n👋 Interrupted. Goodbye!")
            break

