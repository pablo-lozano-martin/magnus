# Magnus Chat Assistant

A simple web-based chat assistant powered by Gemini and LangGraph, built with Flask.

## Running the Application

1.  **Clone the repository:**
    ```bash
    git clone <repository-url>
    cd magnus
    ```

2.  **Create and activate a virtual environment:**
    ```bash
    python3 -m venv .venv
    source .venv/bin/activate
    ```

3.  **Install dependencies:**
    ```bash
    pip install -r requirements.txt
    ```

4.  **Set up environment variables:**
    Create a `.env` file in the project root and add your Gemini API key:
    ```
    GEMINI_API_KEY="YOUR_GEMINI_API_KEY"
    ```

5.  **Run the Flask application:**
    ```bash
    python app.py
    ```

    The application will be available at `http://127.0.0.1:5001`.
