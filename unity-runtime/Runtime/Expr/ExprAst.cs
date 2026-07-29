using System.Collections.Generic;

// 命名空間刻意不叫 StoryRuntime.Expr —— 那會跟 Expr 這個類別撞名，
// 呼叫端寫 `using StoryRuntime.Expr;` 之後 `Expr` 就變成指向命名空間而不是類別。
namespace StoryRuntime.Expressions {

    public abstract class Expr { }

    public sealed class NumberExpr : Expr {
        public double Value;
    }

    public sealed class StringExpr : Expr {
        public string Value;
    }

    public sealed class BoolExpr : Expr {
        public bool Value;
    }

    public sealed class VarExpr : Expr {
        public string Name;
    }

    public sealed class UnaryExpr : Expr {
        public string Op;
        public Expr Operand;
    }

    public sealed class BinaryExpr : Expr {
        public string Op;
        public Expr Left;
        public Expr Right;
    }

    public sealed class CallExpr : Expr {
        public string Name;
        public List<Expr> Args = new List<Expr>();
    }

    public sealed class Assignment {
        public string Target;
        public Expr Value;
    }

    public sealed class ParseError {
        public string Message;
        public int Index;

        public ParseError(string message, int index) {
            Message = message;
            Index   = index;
        }
    }

    public readonly struct ParseResult<T> {
        public bool Ok { get; }
        public T Value { get; }
        public ParseError Error { get; }

        ParseResult(bool ok, T value, ParseError error) {
            Ok    = ok;
            Value = value;
            Error = error;
        }

        public static ParseResult<T> Success(T value) => new ParseResult<T>(true, value, null);
        public static ParseResult<T> Fail(string message, int index) =>
            new ParseResult<T>(false, default, new ParseError(message, index));
        public static ParseResult<T> Fail(ParseError error) => new ParseResult<T>(false, default, error);
    }
}
