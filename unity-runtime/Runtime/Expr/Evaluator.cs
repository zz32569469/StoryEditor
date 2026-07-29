using System;
using System.Collections.Generic;
using System.Globalization;

namespace StoryRuntime.Expressions {

    public enum DeclaredType { Number, String, Bool, Date }

    public sealed class HostFunction {
        // -1 代表參數個數不限。
        public int Arity;
        public Func<StoryValue[], StoryValue> Call;
        public string Description;
        public DeclaredType Returns;
        public DeclaredType[] Params;
    }

    public readonly struct EvalResult {
        public bool Ok { get; }
        public StoryValue Value { get; }
        public string Message { get; }

        EvalResult(bool ok, StoryValue value, string message) {
            Ok      = ok;
            Value   = value;
            Message = message;
        }

        public static EvalResult Success(StoryValue value) => new EvalResult(true, value, null);
        public static EvalResult Fail(string message) => new EvalResult(false, default, message);
    }

    public interface IVariableSource {
        bool TryGet(string name, out StoryValue value);
    }

    public sealed class EvalContext {
        public IVariableSource Variables;
        public Dictionary<string, HostFunction> Functions;
    }

    public static class Evaluator {

        // 逐條對應 src/expr/evaluate.ts。
        public static EvalResult Evaluate(Expr expr, EvalContext context) {
            switch (expr) {
                case NumberExpr n: return EvalResult.Success(StoryValue.Number(n.Value));
                case StringExpr s: return EvalResult.Success(StoryValue.Text(s.Value));
                case BoolExpr b:   return EvalResult.Success(StoryValue.Bool(b.Value));

                case VarExpr v: {
                    if (context.Variables == null || !context.Variables.TryGet(v.Name, out StoryValue value)) {
                        return EvalResult.Fail($"變數 \"{v.Name}\" 還沒有值");
                    }
                    return EvalResult.Success(value);
                }

                case UnaryExpr u: {
                    EvalResult operand = Evaluate(u.Operand, context);
                    if (!operand.Ok) return operand;
                    if (u.Op == "!") return EvalResult.Success(StoryValue.Bool(!operand.Value.IsTruthy()));
                    if (!operand.Value.IsNumber) {
                        return EvalResult.Fail($"負號不能用在{operand.Value.TypeName()}上");
                    }
                    return EvalResult.Success(StoryValue.Number(-operand.Value.AsNumber));
                }

                case CallExpr c: {
                    if (context.Functions == null || !context.Functions.TryGetValue(c.Name, out HostFunction fn)) {
                        return EvalResult.Fail($"沒有這個函式：\"{c.Name}\"");
                    }

                    var args = new StoryValue[c.Args.Count];
                    for (int i = 0; i < c.Args.Count; i += 1) {
                        EvalResult arg = Evaluate(c.Args[i], context);
                        if (!arg.Ok) return arg;
                        args[i] = arg.Value;
                    }
                    if (fn.Arity >= 0 && args.Length != fn.Arity) {
                        return EvalResult.Fail($"{c.Name} 需要 {fn.Arity} 個參數，收到 {args.Length} 個");
                    }
                    try {
                        return EvalResult.Success(fn.Call(args));
                    }
                    catch (Exception error) {
                        return EvalResult.Fail($"{c.Name} 執行失敗：{error}");
                    }
                }

                case BinaryExpr binary: return EvaluateBinary(binary, context);
            }

            return EvalResult.Fail("無法辨識的運算式節點");
        }

        static EvalResult EvaluateBinary(BinaryExpr expr, EvalContext context) {
            // && 與 || 短路，右側可能因此不被求值（右側有未定義變數時這很重要）。
            if (expr.Op == "&&" || expr.Op == "||") {
                EvalResult shortLeft = Evaluate(expr.Left, context);
                if (!shortLeft.Ok) return shortLeft;
                bool leftTruthy = shortLeft.Value.IsTruthy();
                if (expr.Op == "&&" && !leftTruthy) return EvalResult.Success(StoryValue.Bool(false));
                if (expr.Op == "||" && leftTruthy) return EvalResult.Success(StoryValue.Bool(true));
                EvalResult shortRight = Evaluate(expr.Right, context);
                if (!shortRight.Ok) return shortRight;
                return EvalResult.Success(StoryValue.Bool(shortRight.Value.IsTruthy()));
            }

            EvalResult left = Evaluate(expr.Left, context);
            if (!left.Ok) return left;
            EvalResult right = Evaluate(expr.Right, context);
            if (!right.Ok) return right;

            StoryValue a = left.Value;
            StoryValue b = right.Value;

            if (expr.Op == "==") return EvalResult.Success(StoryValue.Bool(a.Equals(b)));
            if (expr.Op == "!=") return EvalResult.Success(StoryValue.Bool(!a.Equals(b)));

            if (expr.Op == "+") {
                // 任一邊是字串就當作字串相加（fullName = lastName + firstName）。
                if (a.IsString || b.IsString) {
                    return EvalResult.Success(StoryValue.Text(a.ToDisplayString() + b.ToDisplayString()));
                }
                if (a.IsNumber && b.IsNumber) {
                    return EvalResult.Success(StoryValue.Number(a.AsNumber + b.AsNumber));
                }
                return EvalResult.Fail($"{a.TypeName()}與{b.TypeName()}不能相加");
            }

            if (!a.IsNumber || !b.IsNumber) {
                return EvalResult.Fail($"\"{expr.Op}\" 兩邊都必須是數字（收到{a.TypeName()}與{b.TypeName()}）");
            }

            double x = a.AsNumber;
            double y = b.AsNumber;

            switch (expr.Op) {
                case "-": return EvalResult.Success(StoryValue.Number(x - y));
                case "*": return EvalResult.Success(StoryValue.Number(x * y));
                case "/":
                    if (y == 0) return EvalResult.Fail("除以零");
                    return EvalResult.Success(StoryValue.Number(x / y));
                case "%":
                    if (y == 0) return EvalResult.Fail("除以零");
                    return EvalResult.Success(StoryValue.Number(x % y));
                case "<":  return EvalResult.Success(StoryValue.Bool(x < y));
                case "<=": return EvalResult.Success(StoryValue.Bool(x <= y));
                case ">":  return EvalResult.Success(StoryValue.Bool(x > y));
                case ">=": return EvalResult.Success(StoryValue.Bool(x >= y));
            }

            return EvalResult.Fail($"尚未支援的運算子 \"{expr.Op}\"");
        }

        // 對應 JS 的 Number(value)。
        //
        // 內建函式全部用它把參數轉成數字（TS 那邊寫的是 args.map(Number)），
        // 所以 Max("5", 3) 會是 5、Abs(true) 會是 1。用 double.Parse 代替會在
        // 空字串、布林、十六進位這幾種輸入上跟 JS 分歧。
        public static double ToNumber(StoryValue value) {
            switch (value.Kind) {
                case ValueKind.Number: return value.AsNumber;
                case ValueKind.Bool:   return value.AsBool ? 1 : 0;
            }

            string text = value.AsString.Trim();
            if (text.Length == 0) return 0;

            if (text == "Infinity" || text == "+Infinity") return double.PositiveInfinity;
            if (text == "-Infinity") return double.NegativeInfinity;

            if (text.Length > 2 && text[0] == '0') {
                char prefix = char.ToLowerInvariant(text[1]);
                int radix = prefix == 'x' ? 16 : prefix == 'o' ? 8 : prefix == 'b' ? 2 : 0;
                if (radix != 0) return ParseRadix(text.Substring(2), radix);
            }

            return double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out double parsed)
                ? parsed
                : double.NaN;
        }

        static double ParseRadix(string digits, int radix) {
            if (digits.Length == 0) return double.NaN;
            double result = 0;
            foreach (char c in digits) {
                int digit =
                    c >= '0' && c <= '9' ? c - '0' :
                    c >= 'a' && c <= 'f' ? c - 'a' + 10 :
                    c >= 'A' && c <= 'F' ? c - 'A' + 10 : -1;
                if (digit < 0 || digit >= radix) return double.NaN;
                result = result * radix + digit;
            }
            return result;
        }

        public static Dictionary<string, HostFunction> CreateBuiltins() {
            var functions = new Dictionary<string, HostFunction>(StringComparer.Ordinal);

            functions["Max"] = new HostFunction {
                Arity = -1, Returns = DeclaredType.Number, Params = new[] { DeclaredType.Number },
                Description = "取最大值",
                // 零個參數時 JS 的 Math.max() 是 -Infinity，不是 0。
                Call = args => {
                    double best = double.NegativeInfinity;
                    foreach (StoryValue arg in args) best = Math.Max(best, ToNumber(arg));
                    return StoryValue.Number(best);
                },
            };
            functions["Min"] = new HostFunction {
                Arity = -1, Returns = DeclaredType.Number, Params = new[] { DeclaredType.Number },
                Description = "取最小值",
                Call = args => {
                    double best = double.PositiveInfinity;
                    foreach (StoryValue arg in args) best = Math.Min(best, ToNumber(arg));
                    return StoryValue.Number(best);
                },
            };
            functions["Abs"] = new HostFunction {
                Arity = 1, Returns = DeclaredType.Number, Params = new[] { DeclaredType.Number },
                Description = "絕對值",
                Call = args => StoryValue.Number(Math.Abs(ToNumber(args[0]))),
            };
            functions["Round"] = new HostFunction {
                Arity = 1, Returns = DeclaredType.Number, Params = new[] { DeclaredType.Number },
                Description = "四捨五入",
                // 不能用 Math.Round：.NET 預設是銀行家捨入，Round(2.5) 會得到 2，
                // 而 JS 的 Math.round(2.5) 是 3。floor(x + 0.5) 才與 JS 一致（含負數）。
                Call = args => StoryValue.Number(Math.Floor(ToNumber(args[0]) + 0.5)),
            };
            functions["Floor"] = new HostFunction {
                Arity = 1, Returns = DeclaredType.Number, Params = new[] { DeclaredType.Number },
                Description = "無條件捨去",
                Call = args => StoryValue.Number(Math.Floor(ToNumber(args[0]))),
            };
            functions["Ceil"] = new HostFunction {
                Arity = 1, Returns = DeclaredType.Number, Params = new[] { DeclaredType.Number },
                Description = "無條件進位",
                Call = args => StoryValue.Number(Math.Ceiling(ToNumber(args[0]))),
            };
            functions["Clamp"] = new HostFunction {
                Arity = 3, Returns = DeclaredType.Number,
                Params = new[] { DeclaredType.Number, DeclaredType.Number, DeclaredType.Number },
                Description = "限制在範圍內",
                Call = args => StoryValue.Number(
                    Math.Min(Math.Max(ToNumber(args[0]), ToNumber(args[1])), ToNumber(args[2]))),
            };
            functions["Len"] = new HostFunction {
                Arity = 1, Returns = DeclaredType.Number, Params = new[] { DeclaredType.String },
                Description = "字串長度",
                Call = args => StoryValue.Number(args[0].ToDisplayString().Length),
            };
            functions["CalcAge"] = new HostFunction {
                Arity = 2, Returns = DeclaredType.Number,
                Params = new[] { DeclaredType.Date, DeclaredType.Date },
                Description = "（預覽暫代）由出生日與基準日算出年齡",
                Call = args => StoryValue.Number(CalcAge(args[0].ToDisplayString(), args[1].ToDisplayString())),
            };

            return functions;
        }

        // 純日期運算，不經過任何時區轉換 —— 年齡不該因為玩家在哪個時區而差一歲。
        public static double CalcAge(string birth, string at) {
            if (!TryParseDate(birth, out int by, out int bm, out int bd)) return 0;
            if (!TryParseDate(at, out int ay, out int am, out int ad)) return 0;

            int age = ay - by;
            if (am < bm || (am == bm && ad < bd)) age -= 1;
            return Math.Max(0, age);
        }

        static bool TryParseDate(string text, out int year, out int month, out int day) {
            year = month = day = 0;
            if (string.IsNullOrEmpty(text) || text.Length < 10) return false;
            if (text[4] != '-' || text[7] != '-') return false;
            return int.TryParse(text.Substring(0, 4), NumberStyles.None, CultureInfo.InvariantCulture, out year)
                && int.TryParse(text.Substring(5, 2), NumberStyles.None, CultureInfo.InvariantCulture, out month)
                && int.TryParse(text.Substring(8, 2), NumberStyles.None, CultureInfo.InvariantCulture, out day);
        }
    }
}
