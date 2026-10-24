namespace StoryRuntime.UI {

    // 劇本的聲音出口。預設實作是 StoryAudioPlayer（對應表＋兩軌 BGM 交叉淡化）；
    // 遊戲已經有自己的音效系統時，實作這個介面接過去即可
    public interface IStoryAudio {
        void PlaySfx(string key);
        // fade：交叉淡化秒數
        void PlayBgm(string key, float fade);
        void StopBgm(float fade);
    }
}
