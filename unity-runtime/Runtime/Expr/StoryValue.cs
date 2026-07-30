using System;
using System.Globalization;

namespace StoryRuntime.Expressions {

    public enum ValueKind { Number, String, Bool }

    // 對應 TS 的 `number | string | boolean`。
    //
    // 不用 object 裝箱是因為相等與轉字串的規則必須跟 JavaScript 一模一樣，
    // 而那些規則跟 .NET 的預設行為在好幾個地方不同（見 ToDisplayString 與 Equals）。
    // 讓型別自己扛這件事，呼叫端就不會各自寫出略有差異的版本。
    public readonly struct StoryValue : IEquatable<StoryValue> {

        public ValueKind Kind { get; }

        readonly double _number;
        readonly string _text;
        readonly bool _bool;

        StoryValue(ValueKind kind, double number, string text, bool boolean) {
            Kind    = kind;
            _number = number;
            _text   = text;
            _bool   = boolean;
        }

        public static StoryValue Number(double value) => new StoryValue(ValueKind.Number, value, null, false);
        public static StoryValue Text(string value)   => new StoryValue(ValueKind.String, 0, value ?? "", false);
        public static StoryValue Bool(bool value)     => new StoryValue(ValueKind.Bool, 0, null, value);

        public bool IsNumber => Kind == ValueKind.Number;
        public bool IsString => Kind == ValueKind.String;
        public bool IsBool   => Kind == ValueKind.Bool;

        public double AsNumber => _number;
        public string AsString => _text;
        public bool AsBool     => _bool;

        // 空字串與 0 為假，其餘為真。
        public bool IsTruthy() {
            switch (Kind) {
                case ValueKind.Bool:   return _bool;
                case ValueKind.Number: return _number != 0;
                default:               return _text != "";
            }
        }

        // 對應 JS 的 ===：型別不同一律為假，不做任何隱式轉換。
        public bool Equals(StoryValue other) {
            if (Kind != other.Kind) return false;
            switch (Kind) {
                case ValueKind.Bool:   return _bool == other._bool;
                case ValueKind.Number: return _number == other._number;
                default:               return string.Equals(_text, other._text, StringComparison.Ordinal);
            }
        }

        public override bool Equals(object obj) => obj is StoryValue other && Equals(other);

        public override int GetHashCode() {
            switch (Kind) {
                case ValueKind.Bool:   return _bool ? 1 : 0;
                case ValueKind.Number: return _number.GetHashCode();
                default:               return _text?.GetHashCode() ?? 0;
            }
        }

        // 對應 JS 的 String(value)。
        //
        // 兩個 .NET 預設會出錯的地方：布林的 ToString() 是 "True"（首字大寫），
        // 而數字會跟著當前文化 —— 在德語系統上小數點會變成逗號，
        // 台詞裡的插值就會突然長得不一樣。
        public string ToDisplayString() {
            switch (Kind) {
                case ValueKind.Bool:   return _bool ? "true" : "false";
                case ValueKind.Number: return JsNumber.ToJsString(_number);
                default:               return _text;
            }
        }

        public string TypeName() {
            switch (Kind) {
                case ValueKind.Bool:   return "布林";
                case ValueKind.Number: return "數字";
                default:               return "字串";
            }
        }

        public override string ToString() => ToDisplayString();
    }

    public static class JsNumber {

        // JS 的 String(number)。
        //
        // .NET Core 3.0 之後 double.ToString() 已經是「最短可還原」表示，
        // 與 JS 相同，所以一般數值直接對得上。剩下要自己處理的是那些
        // .NET 與 JS 寫法不同的邊界：非數、無限大、負零，以及指數表示法的門檻。
        public static string ToJsString(double value) {
            if (double.IsNaN(value)) return "NaN";
            if (double.IsPositiveInfinity(value)) return "Infinity";
            if (double.IsNegativeInfinity(value)) return "-Infinity";
            // JS 的 String(-0) 是 "0"，.NET 的是 "-0"。
            if (value == 0) return "0";

            double magnitude = Math.Abs(value);
            // JS 在 >=1e21 與 <1e-6 才改用指數表示，門檻與 .NET 不同。
            if (magnitude >= 1e21 || magnitude < 1e-6) return ExponentialForm(value);

            return value.ToString("R", CultureInfo.InvariantCulture);
        }

        // JS 的 Number(string)。
        //
        // 標記參數與內建函式都要用它，不能用 double.Parse —— 兩者在空字串、
        // 十六進位前綴這幾種輸入上不同，而既有劇本的參數是人手寫的，什麼都可能出現。
        public static double Parse(string raw) {
            string text = (raw ?? "").Trim();
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

        static string ExponentialForm(double value) {
            // JS 寫成 1e+21 / 1e-7（尾數不補零、指數不補零）。
            string text = value.ToString("R", CultureInfo.InvariantCulture);
            int marker = text.IndexOf('E');
            if (marker < 0) return text;

            string mantissa = text.Substring(0, marker);
            string exponent = text.Substring(marker + 1);
            char sign = exponent[0] == '-' ? '-' : '+';
            string digits = exponent.TrimStart('+', '-').TrimStart('0');
            if (digits.Length == 0) digits = "0";
            return mantissa + "e" + sign + digits;
        }
    }
}
