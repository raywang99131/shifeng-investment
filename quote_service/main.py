from flask import Flask, jsonify, request
from services.akshareFetcher import fetch_batch_quotes, fetch_single_quote

app = Flask(__name__)

@app.route("/")
def root():
    return jsonify({"message": "Shifeng Quote Service", "version": "1.0.0"})

@app.route("/health")
def health():
    return jsonify({"status": "ok"})

@app.route("/quotes/batch")
def batch_quotes():
    codes = request.args.get("codes", "")
    code_list = [c.strip() for c in codes.split(",") if c.strip()]
    if not code_list:
        return jsonify({"success": False, "error": "No codes provided"}), 400
    if len(code_list) > 50:
        return jsonify({"success": False, "error": "Max 50 codes per request"}), 400

    result = fetch_batch_quotes(code_list)
    return jsonify(result)

@app.route("/quotes")
def single_quote():
    code = request.args.get("code", "")
    if not code:
        return jsonify({"success": False, "error": "No code provided"}), 400

    quote = fetch_single_quote(code)
    if not quote:
        return jsonify({"success": False, "error": f"No data for {code}"}), 404
    return jsonify(quote)

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=3001)