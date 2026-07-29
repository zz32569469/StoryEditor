using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace StoryRuntime.Expressions {

    // 條件與賦值運算式的解析器。逐條對應 src/expr/parse.ts —— 兩邊分歧的話，
    // 網頁預覽會顯示一種結果、遊戲跑出另一種，而且不會有任何錯誤訊息。
    //
    // 跟 TS 那份一樣**永不拋例外**：解析失敗回傳錯誤，由呼叫端決定怎麼處理。
    public static class ExprParser {

        enum TokenType { Number, String, Name, Op, Eof }

        struct Token {
            public TokenType Type;
            public string Text;
            public double Num;
            public string Str;
            public int Index;
        }

        // 順序即最長匹配優先：兩字元的運算子必須排在單字元前面，
        // 否則 "&&" 會被切成兩個 "&"（而 "&" 根本不是合法運算子）。
        static readonly string[] Operators = {
            "&&", "||", "==", "!=", "<=", ">=",
            "<", ">", "+", "-", "*", "/", "%", "(", ")", ",", "!", "=",
        };

        static readonly Dictionary<string, int> Precedence = new Dictionary<string, int> {
            { "||", 1 },
            { "&&", 2 },
            { "==", 3 }, { "!=", 3 },
            { "<", 4 }, { "<=", 4 }, { ">", 4 }, { ">=", 4 },
            { "+", 5 }, { "-", 5 },
            { "*", 6 }, { "/", 6 }, { "%", 6 },
        };

        static bool IsDigit(char c) => c >= '0' && c <= '9';
        static bool IsNameStart(char c) => c == '_' || (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z');
        static bool IsNamePart(char c) => IsNameStart(c) || IsDigit(c);

        static ParseResult<List<Token>> Tokenize(string input) {
            var tokens = new List<Token>();
            int i = 0;

            while (i < input.Length) {
                char ch = input[i];

                if (char.IsWhiteSpace(ch)) {
                    i += 1;
                    continue;
                }

                if (IsDigit(ch) || (ch == '.' && i + 1 < input.Length && IsDigit(input[i + 1]))) {
                    int start = i;
                    while (i < input.Length && (IsDigit(input[i]) || input[i] == '.')) i += 1;
                    string text = input.Substring(start, i - start);
                    // 貪婪吃掉所有數字與點，所以 "1.2.3" 會走到這裡失敗 —— 與 TS 的 Number() 一致。
                    if (!double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out double value)
                        || double.IsInfinity(value) || double.IsNaN(value)) {
                        return ParseResult<List<Token>>.Fail($"\"{text}\" 不是有效的數字", start);
                    }
                    tokens.Add(new Token { Type = TokenType.Number, Text = text, Num = value, Index = start });
                    continue;
                }

                if (ch == '"' || ch == '\'') {
                    int start = i;
                    char quote = ch;
                    i += 1;
                    var text = new StringBuilder();
                    while (i < input.Length && input[i] != quote) {
                        // 跳脫只是「取下一個字元的字面」，\n 不會變成換行 —— 與 TS 相同。
                        if (input[i] == '\\' && i + 1 < input.Length) {
                            text.Append(input[i + 1]);
                            i += 2;
                            continue;
                        }
                        text.Append(input[i]);
                        i += 1;
                    }
                    if (i >= input.Length || input[i] != quote) {
                        return ParseResult<List<Token>>.Fail("字串沒有結束的引號", start);
                    }
                    i += 1;
                    tokens.Add(new Token {
                        Type  = TokenType.String,
                        Text  = input.Substring(start, i - start),
                        Str   = text.ToString(),
                        Index = start,
                    });
                    continue;
                }

                if (IsNameStart(ch)) {
                    int start = i;
                    while (i < input.Length && IsNamePart(input[i])) i += 1;
                    tokens.Add(new Token {
                        Type  = TokenType.Name,
                        Text  = input.Substring(start, i - start),
                        Index = start,
                    });
                    continue;
                }

                string op = null;
                foreach (string candidate in Operators) {
                    if (string.CompareOrdinal(input, i, candidate, 0, candidate.Length) == 0) {
                        op = candidate;
                        break;
                    }
                }
                if (op != null) {
                    tokens.Add(new Token { Type = TokenType.Op, Text = op, Index = i });
                    i += op.Length;
                    continue;
                }

                return ParseResult<List<Token>>.Fail($"無法辨識的字元 \"{ch}\"", i);
            }

            tokens.Add(new Token { Type = TokenType.Eof, Text = "", Index = input.Length });
            return ParseResult<List<Token>>.Success(tokens);
        }

        sealed class Cursor {
            readonly List<Token> _tokens;
            int _pos;

            public Cursor(List<Token> tokens, int start = 0) {
                _tokens = tokens;
                _pos    = start;
            }

            public Token Peek() => _tokens[_pos];
            public Token Next() => _tokens[_pos++];
            public void Advance() => _pos += 1;
            public bool AtEnd() => Peek().Type == TokenType.Eof;

            public ParseError ExpectOp(string op) {
                Token token = Peek();
                if (token.Type == TokenType.Op && token.Text == op) {
                    _pos += 1;
                    return null;
                }
                return new ParseError($"這裡需要 \"{op}\"", token.Index);
            }

            public ParseResult<Expr> ParseExpression(int minPrecedence = 0) {
                ParseResult<Expr> left = ParseUnary();
                if (!left.Ok) return left;

                while (true) {
                    Token token = Peek();
                    if (token.Type != TokenType.Op) break;
                    if (!Precedence.TryGetValue(token.Text, out int precedence)) break;
                    if (precedence <= minPrecedence) break;

                    _pos += 1;
                    ParseResult<Expr> right = ParseExpression(precedence);
                    if (!right.Ok) return right;
                    left = ParseResult<Expr>.Success(new BinaryExpr {
                        Op    = token.Text,
                        Left  = left.Value,
                        Right = right.Value,
                    });
                }

                return left;
            }

            ParseResult<Expr> ParseUnary() {
                Token token = Peek();
                if (token.Type == TokenType.Op && (token.Text == "!" || token.Text == "-")) {
                    _pos += 1;
                    ParseResult<Expr> operand = ParseUnary();
                    if (!operand.Ok) return operand;
                    return ParseResult<Expr>.Success(new UnaryExpr { Op = token.Text, Operand = operand.Value });
                }
                return ParsePrimary();
            }

            ParseResult<Expr> ParsePrimary() {
                Token token = Next();

                if (token.Type == TokenType.Number) {
                    return ParseResult<Expr>.Success(new NumberExpr { Value = token.Num });
                }
                if (token.Type == TokenType.String) {
                    return ParseResult<Expr>.Success(new StringExpr { Value = token.Str });
                }

                if (token.Type == TokenType.Name) {
                    string lower = token.Text.ToLowerInvariant();
                    if (lower == "true" || lower == "false") {
                        return ParseResult<Expr>.Success(new BoolExpr { Value = lower == "true" });
                    }

                    Token after = Peek();
                    if (after.Type == TokenType.Op && after.Text == "(") {
                        _pos += 1;
                        var args = new List<Expr>();
                        if (!(Peek().Type == TokenType.Op && Peek().Text == ")")) {
                            while (true) {
                                ParseResult<Expr> arg = ParseExpression();
                                if (!arg.Ok) return arg;
                                args.Add(arg.Value);
                                Token separator = Peek();
                                if (separator.Type == TokenType.Op && separator.Text == ",") {
                                    _pos += 1;
                                    continue;
                                }
                                break;
                            }
                        }
                        ParseError error = ExpectOp(")");
                        if (error != null) return ParseResult<Expr>.Fail(error);
                        return ParseResult<Expr>.Success(new CallExpr { Name = token.Text, Args = args });
                    }

                    return ParseResult<Expr>.Success(new VarExpr { Name = token.Text });
                }

                if (token.Type == TokenType.Op && token.Text == "(") {
                    ParseResult<Expr> inner = ParseExpression();
                    if (!inner.Ok) return inner;
                    ParseError closing = ExpectOp(")");
                    if (closing != null) return ParseResult<Expr>.Fail(closing);
                    return inner;
                }

                return ParseResult<Expr>.Fail(
                    token.Type == TokenType.Eof ? "運算式突然結束" : $"這裡不該出現 \"{token.Text}\"",
                    token.Index);
            }
        }

        public static ParseResult<Expr> ParseExpression(string input) {
            if (string.IsNullOrWhiteSpace(input)) return ParseResult<Expr>.Fail("運算式是空的", 0);

            ParseResult<List<Token>> tokens = Tokenize(input);
            if (!tokens.Ok) return ParseResult<Expr>.Fail(tokens.Error);

            var cursor = new Cursor(tokens.Value);
            ParseResult<Expr> result = cursor.ParseExpression();
            if (!result.Ok) return result;
            if (!cursor.AtEnd()) {
                Token token = cursor.Peek();
                return ParseResult<Expr>.Fail($"多餘的內容 \"{token.Text}\"", token.Index);
            }
            return result;
        }

        public static ParseResult<Assignment> ParseAssignment(string input) {
            if (string.IsNullOrWhiteSpace(input)) return ParseResult<Assignment>.Fail("賦值是空的", 0);

            ParseResult<List<Token>> tokens = Tokenize(input);
            if (!tokens.Ok) return ParseResult<Assignment>.Fail(tokens.Error);

            List<Token> list = tokens.Value;
            Token target = list[0];
            if (target.Type != TokenType.Name) {
                return ParseResult<Assignment>.Fail("賦值要以變數名開頭", target.Index);
            }
            if (list.Count < 2 || !(list[1].Type == TokenType.Op && list[1].Text == "=")) {
                return ParseResult<Assignment>.Fail("變數名後面需要 \"=\"", list.Count < 2 ? 0 : list[1].Index);
            }

            var cursor = new Cursor(list, 2);
            ParseResult<Expr> value = cursor.ParseExpression();
            if (!value.Ok) return ParseResult<Assignment>.Fail(value.Error);
            if (!cursor.AtEnd()) {
                Token token = cursor.Peek();
                return ParseResult<Assignment>.Fail($"多餘的內容 \"{token.Text}\"", token.Index);
            }
            return ParseResult<Assignment>.Success(new Assignment { Target = target.Text, Value = value.Value });
        }

        public static ParseResult<List<string>> ParseInputTargets(string input) {
            string[] parts = (input ?? "").Split(',');
            var names = new List<string>();
            foreach (string part in parts) names.Add(part.Trim());

            foreach (string name in names) {
                if (name.Length == 0) {
                    return ParseResult<List<string>>.Fail("輸入節點需要一到多個變數名（以逗號分隔）", 0);
                }
            }
            foreach (string name in names) {
                if (!IsIdentifier(name)) {
                    return ParseResult<List<string>>.Fail($"\"{name}\" 不是合法的變數名", 0);
                }
            }
            return ParseResult<List<string>>.Success(names);
        }

        static bool IsIdentifier(string name) {
            if (name.Length == 0 || !IsNameStart(name[0])) return false;
            for (int i = 1; i < name.Length; i += 1) {
                if (!IsNamePart(name[i])) return false;
            }
            return true;
        }

        public static void CollectVariables(Expr expr, HashSet<string> into) {
            switch (expr) {
                case VarExpr v:
                    into.Add(v.Name);
                    break;
                case UnaryExpr u:
                    CollectVariables(u.Operand, into);
                    break;
                case BinaryExpr b:
                    CollectVariables(b.Left, into);
                    CollectVariables(b.Right, into);
                    break;
                case CallExpr c:
                    foreach (Expr arg in c.Args) CollectVariables(arg, into);
                    break;
            }
        }
    }
}
