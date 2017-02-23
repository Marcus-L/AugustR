#r "Newtonsoft.Json"

using Newtonsoft.Json;
using System.Net;
using System.Text;

// note: leave the "key=" in there, it's required
private const string FIREBASE_SERVER_KEY = "key=YOUR_KEY_HERE";

public static async Task<HttpResponseMessage> Run(HttpRequestMessage req, TraceWriter log)
{
    var client = new HttpClient();
    client.DefaultRequestHeaders.TryAddWithoutValidation("Authorization", FIREBASE_SERVER_KEY);
    var response = await client.PostAsync("https://fcm.googleapis.com/fcm/send", 
        new StringContent(JsonConvert.SerializeObject(new
            {
                data = new { action = "unlock" },
                to = "/topics/unlock"
            }
        ), Encoding.UTF8, "application/json"));
    log.Info("Sent FCM Notification, got HTTP " + response.StatusCode);
    return req.CreateResponse(response.StatusCode, "Sent unlock request");
}