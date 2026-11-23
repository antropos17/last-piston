using System;
using System.Drawing;
using System.IO;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

internal sealed class Workshop : Form
{
    private readonly WebView2 web = new WebView2();

    private Workshop()
    {
        Text = "Last Piston — моторный стенд";
        ClientSize = new Size(1360, 850);
        MinimumSize = new Size(840, 620);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(35, 42, 38);
        web.DefaultBackgroundColor = BackColor;
        web.Dock = DockStyle.Fill;
        Controls.Add(web);
        Shown += OpenStand;
    }

    private async void OpenStand(object sender, EventArgs args)
    {
        try
        {
            string assets = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "app");
            if (!File.Exists(Path.Combine(assets, "index.html")))
                throw new IOException("Папка app должна находиться рядом с Last Piston.exe.");
            string profile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Last Piston", "WebView");
            var environment = await CoreWebView2Environment.CreateAsync(null, profile);
            await web.EnsureCoreWebView2Async(environment);
            var core = web.CoreWebView2;
            core.SetVirtualHostNameToFolderMapping("piston.local", assets, CoreWebView2HostResourceAccessKind.DenyCors);
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.AreBrowserAcceleratorKeysEnabled = false;
            core.NavigationStarting += (s, e) => {
                Uri uri;
                e.Cancel = !Uri.TryCreate(e.Uri, UriKind.Absolute, out uri) || uri.Scheme != "https" || uri.Host != "piston.local";
            };
            core.Navigate("https://piston.local/index.html");
        }
        catch (Exception error)
        {
            MessageBox.Show(this, "Не удалось открыть стенд. Для запуска нужен Microsoft Edge WebView2 Runtime.\n\n" + error.Message, Text);
            Close();
        }
    }

    [STAThread]
    private static void Main()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new Workshop());
    }
}
