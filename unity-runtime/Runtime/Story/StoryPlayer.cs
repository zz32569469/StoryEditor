using System.Collections.Generic;
using StoryRuntime.Expressions;

namespace StoryRuntime.Story {

    public enum PlayerStatus {
        // 停在一句台詞上，等待玩家繼續。
        Line,
        // 停在選項上，等待玩家選擇。
        Choices,
        // 等待玩家輸入。
        Input,
        // 劇情結束。
        Ended,
        // 出錯而停下（未定義變數、運算式壞掉、跳轉斷掉…）。
        Error,
    }

    // 遊戲擁有變數的真實來源；runtime 只透過這個介面讀寫，自己不存任何狀態。
    // 少了這條界線，composure 這種遊戲變數會在 runtime 與存檔各留一份而漸漸不同步。
    public interface IStoryVariables : IVariableSource {
        void Set(string name, StoryValue value);
    }

    // 叫 StoryState 而不是 TS 那邊的 PlayerState：遊戲端多半已經有自己的 PlayerState
    // （玩家金錢、體力那種），using StoryRuntime.Story 時兩個同名型別會讓編譯失敗。
    public sealed class StoryState {
        public string SceneId;
        // 目前停留的節點；Ended 時可能為 null。
        public string NodeId;
        public PlayerStatus Status;
        // Input 狀態時要填的變數名。
        public List<string> PendingInputs = new List<string>();
        // Choices 狀態時玩家看得到的選項 id，依劇本順序。
        // 解鎖條件在抵達選項時判斷一次並記在這裡：UI 只照這份顯示，Choose 也只收這份裡的 id。
        public List<string> AvailableChoices = new List<string>();
        public string Error;
        // 走過的節點，用來偵測無限迴圈，也方便測試比對走訪路徑。
        public List<string> Visited = new List<string>();
    }

    public sealed class PlayerOptions {
        // 遊戲特有的函式，會覆蓋同名的內建函式。
        public Dictionary<string, HostFunction> Functions;
    }

    // 劇情播放器。純狀態機，不碰 UI。
    //
    // 走訪規則逐條對應 src/runtime/player.ts —— 那份是規格。
    // 兩邊分歧的話，網頁預覽會走一條路、遊戲走另一條，而且不會有任何錯誤訊息。
    public static class StoryPlayer {

        // 單次推進最多可以連續處理幾個節點，超過視為迴圈。
        const int MaxSteps = 1000;

        public static void SeedDefaults(StoryProject project, IStoryVariables into) {
            foreach (StoryVariable variable in project.Variables) {
                if (variable.Id == null) continue;
                into.Set(variable.Id, DefaultValueOf(variable));
            }
        }

        // 遊戲端只想補「還沒有值」的變數時用 —— SeedDefaults 會整批覆蓋，
        // 對已經接到遊戲欄位的變數（composure 之類）那等於把遊戲狀態重設掉。
        public static StoryValue DefaultValueOf(StoryVariable variable) {
            switch (variable.DefaultValue) {
                case null:   return StoryValue.Text("");
                case bool b: return StoryValue.Bool(b);
                case string s: return StoryValue.Text(s);
                case long l: return StoryValue.Number(l);
                case double d: return StoryValue.Number(d);
                default: return StoryValue.Text(variable.DefaultValue.ToString());
            }
        }

        public static StoryState StartScene(
            StoryProject project, string sceneId, IStoryVariables variables, PlayerOptions options = null) {

            var state = new StoryState { SceneId = sceneId, Status = PlayerStatus.Line };
            StoryScene scene = project.FindScene(sceneId);
            if (scene == null) return Fail(state, $"找不到場景 {sceneId}");

            state.NodeId = scene.EntryNodeId;
            return Settle(state, scene, variables, options);
        }

        // 讀檔用：從存檔記下的節點重新進入，停在那一句的開頭。
        // 存檔只會記在停得下來的節點（台詞、選項、輸入），所以 Settle 不會重跑任何 set ——
        // 選項的解鎖條件則會依讀檔當下的變數重新判斷。
        public static StoryState ResumeAt(
            StoryProject project, string sceneId, string nodeId, IStoryVariables variables, PlayerOptions options = null) {

            var state = new StoryState { SceneId = sceneId, Status = PlayerStatus.Line };
            StoryScene scene = project.FindScene(sceneId);
            if (scene == null) return Fail(state, $"找不到場景 {sceneId}");
            if (scene.FindNode(nodeId) == null) return Fail(state, $"找不到節點 {nodeId}");

            state.NodeId = nodeId;
            return Settle(state, scene, variables, options);
        }

        public static StoryState Advance(
            StoryProject project, StoryState state, IStoryVariables variables, PlayerOptions options = null) {

            StoryScene scene = project.FindScene(state.SceneId);
            if (scene == null) return Fail(state, $"找不到場景 {state.SceneId}");
            if (state.Status != PlayerStatus.Line) return state;

            StoryNode node = scene.FindNode(state.NodeId);
            if (node == null) return Fail(state, $"找不到節點 {state.NodeId}");

            state.NodeId = node.Next;
            return Settle(state, scene, variables, options);
        }

        public static StoryState Choose(
            StoryProject project, StoryState state, string choiceId,
            IStoryVariables variables, PlayerOptions options = null) {

            StoryScene scene = project.FindScene(state.SceneId);
            if (scene == null) return Fail(state, $"找不到場景 {state.SceneId}");
            if (state.Status != PlayerStatus.Choices) return state;

            StoryNode node = scene.FindNode(state.NodeId);
            StoryChoice choice = null;
            if (node != null) {
                foreach (StoryChoice candidate in node.Choices) {
                    if (candidate.Id == choiceId) { choice = candidate; break; }
                }
            }
            if (choice == null) return Fail(state, $"找不到選項 {choiceId}");
            if (!state.AvailableChoices.Contains(choiceId)) {
                return Fail(state, $"選項 {choiceId} 的條件不成立，不能選");
            }

            state.NodeId = choice.TargetNodeId;
            return Settle(state, scene, variables, options);
        }

        public static StoryState SubmitInput(
            StoryProject project, StoryState state, Dictionary<string, StoryValue> values,
            IStoryVariables variables, PlayerOptions options = null) {

            StoryScene scene = project.FindScene(state.SceneId);
            if (scene == null) return Fail(state, $"找不到場景 {state.SceneId}");
            if (state.Status != PlayerStatus.Input) return state;

            StoryNode node = scene.FindNode(state.NodeId);
            if (node == null) return Fail(state, $"找不到節點 {state.NodeId}");

            foreach (string name in state.PendingInputs) {
                values.TryGetValue(name, out StoryValue raw);
                variables.Set(name, CoerceInput(project, name, raw));
            }

            state.PendingInputs = new List<string>();
            state.NodeId = node.Next;
            return Settle(state, scene, variables, options);
        }

        // 依變數的宣告型別轉換，而不是看輸入長得像什麼。
        // 「00812」這種看起來像數字的文字若被轉成 812，玩家的輸入就被吃掉了。
        static StoryValue CoerceInput(StoryProject project, string name, StoryValue raw) {
            string declared = null;
            foreach (StoryVariable variable in project.Variables) {
                if (variable.Id == name) { declared = variable.Type; break; }
            }

            switch (declared) {
                case "number": {
                    double parsed = Evaluator.ToNumber(raw);
                    return StoryValue.Number(double.IsNaN(parsed) || double.IsInfinity(parsed) ? 0 : parsed);
                }
                // 日期與文字都保持字串 —— 日期若被轉成數字，CalcAge 會拿到無效值。
                case "date":
                case "string":
                    return StoryValue.Text(raw.ToDisplayString());
                case "bool":
                    return StoryValue.Bool(raw.IsBool ? raw.AsBool : raw.ToDisplayString() == "true");
            }

            // 沒有宣告時只好看外觀猜：數字外觀轉數字，否則 age < 25 這種比較會失敗。
            if (raw.IsString) {
                string text = raw.AsString.Trim();
                if (text.Length > 0) {
                    double parsed = Evaluator.ToNumber(raw);
                    if (!double.IsNaN(parsed) && !double.IsInfinity(parsed)) return StoryValue.Number(parsed);
                }
            }
            return raw;
        }

        // 從指定節點往下跑，直到停在需要玩家操作的地方。
        // branch / set 這類流程控制節點不需要玩家介入，會連續處理完。
        static StoryState Settle(
            StoryState state, StoryScene scene, IStoryVariables variables, PlayerOptions options) {

            var context = new EvalContext {
                Variables = variables,
                Functions = MergeFunctions(options),
            };
            state.AvailableChoices = new List<string>();

            for (int step = 0; step < MaxSteps; step += 1) {
                if (state.NodeId == null) {
                    state.Status = PlayerStatus.Ended;
                    return state;
                }

                StoryNode node = scene.FindNode(state.NodeId);
                if (node == null) return Fail(state, $"找不到節點 {state.NodeId}");

                state.Visited.Add(node.Id);

                switch (node.Kind) {
                    case "end":
                        state.Status = PlayerStatus.Ended;
                        state.NodeId = node.Id;
                        return state;

                    case "input": {
                        ParseResult<List<string>> targets = ExprParser.ParseInputTargets(node.Expression ?? "");
                        if (!targets.Ok) return Fail(state, $"輸入節點：{targets.Error.Message}");
                        state.Status = PlayerStatus.Input;
                        state.PendingInputs = targets.Value;
                        return state;
                    }

                    case "set": {
                        ParseResult<Assignment> assignment = ExprParser.ParseAssignment(node.Expression ?? "");
                        if (!assignment.Ok) {
                            return Fail(state, $"賦值「{node.Expression}」：{assignment.Error.Message}");
                        }
                        EvalResult result = Evaluator.Evaluate(assignment.Value.Value, context);
                        if (!result.Ok) return Fail(state, $"賦值「{node.Expression}」：{result.Message}");

                        variables.Set(assignment.Value.Target, result.Value);
                        state.NodeId = node.Next;
                        continue;
                    }

                    case "branch": {
                        bool taken = false;
                        string target = null;
                        foreach (StoryBranch branch in node.Branches) {
                            ParseResult<Expr> parsed = ExprParser.ParseExpression(branch.Condition);
                            if (!parsed.Ok) {
                                return Fail(state, $"條件「{branch.Condition}」：{parsed.Error.Message}");
                            }
                            EvalResult result = Evaluator.Evaluate(parsed.Value, context);
                            if (!result.Ok) return Fail(state, $"條件「{branch.Condition}」：{result.Message}");
                            if (result.Value.IsTruthy()) {
                                taken = true;
                                target = branch.TargetNodeId;
                                break;
                            }
                        }
                        if (!taken) {
                            // 沒有任何條件成立。來源劇本的分支通常互補，走到這裡多半是資料問題。
                            var conditions = new List<string>();
                            foreach (StoryBranch branch in node.Branches) conditions.Add(branch.Condition);
                            return Fail(state, $"分支沒有任何條件成立：{string.Join("、", conditions)}");
                        }
                        state.NodeId = target;
                        continue;
                    }

                    default: {
                        // line：有選項就停在選項，否則停在台詞。
                        if (node.Choices.Count == 0) {
                            state.Status = PlayerStatus.Line;
                            return state;
                        }

                        var available = new List<string>();
                        foreach (StoryChoice choice in node.Choices) {
                            if (string.IsNullOrWhiteSpace(choice.Condition)) {
                                available.Add(choice.Id);
                                continue;
                            }
                            ParseResult<Expr> parsed = ExprParser.ParseExpression(choice.Condition);
                            if (!parsed.Ok) {
                                return Fail(state, $"選項條件「{choice.Condition}」：{parsed.Error.Message}");
                            }
                            EvalResult result = Evaluator.Evaluate(parsed.Value, context);
                            if (!result.Ok) return Fail(state, $"選項條件「{choice.Condition}」：{result.Message}");
                            if (result.Value.IsTruthy()) available.Add(choice.Id);
                        }
                        if (available.Count == 0) {
                            // 停在一個沒有任何選項可按的畫面，玩家只能卡死；明確報錯才找得到是哪一組。
                            var conditions = new List<string>();
                            foreach (StoryChoice choice in node.Choices) conditions.Add(choice.Condition ?? "");
                            return Fail(state, $"所有選項的條件都不成立：{string.Join("、", conditions)}");
                        }
                        state.Status = PlayerStatus.Choices;
                        state.AvailableChoices = available;
                        return state;
                    }
                }
            }

            return Fail(state, $"連續處理超過 {MaxSteps} 個節點，可能有無限迴圈");
        }

        static Dictionary<string, HostFunction> MergeFunctions(PlayerOptions options) {
            Dictionary<string, HostFunction> functions = Evaluator.CreateBuiltins();
            if (options?.Functions != null) {
                foreach (KeyValuePair<string, HostFunction> pair in options.Functions) {
                    functions[pair.Key] = pair.Value;
                }
            }
            return functions;
        }

        static StoryState Fail(StoryState state, string message) {
            state.Status = PlayerStatus.Error;
            state.Error = message;
            return state;
        }

        public static StoryNode CurrentNode(StoryProject project, StoryState state) {
            StoryScene scene = project.FindScene(state.SceneId);
            return scene?.FindNode(state.NodeId);
        }
    }
}
