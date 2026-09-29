using System.Diagnostics;
using System.IO;
using System.Text.Json;

namespace LightSession.Desktop;

internal static class NativeMessagingHost
{
    private const int MaximumMessageBytes = 64 * 1024 * 1024;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public static bool ShouldRun(string[] args) => args.Any(argument =>
        argument.Equals("--native-messaging", StringComparison.OrdinalIgnoreCase) ||
        argument.StartsWith("chrome-extension://", StringComparison.OrdinalIgnoreCase) ||
        argument.StartsWith("moz-extension://", StringComparison.OrdinalIgnoreCase));

    public static async Task RunAsync()
    {
        var input = Console.OpenStandardInput();
        var output = Console.OpenStandardOutput();
        var store = new ConversationStore();

        while (true)
        {
            var lengthBuffer = new byte[4];
            if (!await ReadExactlyOrEofAsync(input, lengthBuffer)) return;
            var length = BitConverter.ToInt32(lengthBuffer, 0);
            if (length is <= 0 or > MaximumMessageBytes)
            {
                await WriteAsync(output, new { ok = false, error = "消息大小无效。" });
                return;
            }

            try
            {
                var payload = new byte[length];
                if (!await ReadExactlyOrEofAsync(input, payload)) return;
                var request = JsonSerializer.Deserialize<SyncEnvelope>(payload, JsonOptions)
                    ?? throw new InvalidDataException("同步消息为空。");
                if (request.ProtocolVersion != 1 || request.Type != "syncConversation" || request.Conversation is null)
                    throw new InvalidDataException("不支持的同步协议。");

                var saved = await store.UpsertAsync(request.Conversation);
                if (request.Open) LaunchDesktop(saved.Id);
                await WriteAsync(output, new { ok = true, conversationId = saved.Id, messageCount = saved.Messages.Count });
            }
            catch (Exception exception)
            {
                await WriteAsync(output, new { ok = false, error = exception.Message });
            }
        }
    }

    private static void LaunchDesktop(string conversationId)
    {
        var executable = Environment.ProcessPath;
        if (string.IsNullOrWhiteSpace(executable)) return;
        Process.Start(new ProcessStartInfo
        {
            FileName = executable,
            ArgumentList = { "--open", conversationId },
            UseShellExecute = true,
        });
    }

    private static async Task<bool> ReadExactlyOrEofAsync(Stream input, byte[] buffer)
    {
        var offset = 0;
        while (offset < buffer.Length)
        {
            var count = await input.ReadAsync(buffer.AsMemory(offset));
            if (count == 0) return false;
            offset += count;
        }
        return true;
    }

    private static async Task WriteAsync(Stream output, object value)
    {
        var payload = JsonSerializer.SerializeToUtf8Bytes(value, JsonOptions);
        await output.WriteAsync(BitConverter.GetBytes(payload.Length));
        await output.WriteAsync(payload);
        await output.FlushAsync();
    }
}
