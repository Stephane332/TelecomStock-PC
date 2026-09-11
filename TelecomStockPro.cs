using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Windows.Forms;

namespace TelecomStockPro
{
    static class Program
    {
        private static Process serverProcess;
        private static NotifyIcon trayIcon;

        [STAThread]
        static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            // Vérifier Node.js
            if (!IsNodeInstalled())
            {
                MessageBox.Show("Node.js n'est pas installé !\n\nTéléchargez-le depuis https://nodejs.org", 
                    "TelecomStock Pro", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }

            // Dossier de l'application
            string appDir = Path.GetDirectoryName(Application.ExecutableExecutablePath);
            string serverPath = Path.Combine(appDir, "server.js");

            if (!File.Exists(serverPath))
            {
                MessageBox.Show("Fichier server.js introuvable !", 
                    "TelecomStock Pro", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }

            // Démarrer le serveur
            StartServer(appDir);

            // Créer l'icône dans la barre des tâche
            CreateTrayIcon();

            // Ouvrir le navigateur
            Thread.Sleep(2000);
            Process.Start("http://localhost:3002");

            // Lancer l'application
            Application.Run();

            // Arrêter le serveur à la fermeture
            StopServer();
        }

        private static bool IsNodeInstalled()
        {
            try
            {
                var process = new Process
                {
                    StartInfo = new ProcessStartInfo
                    {
                        FileName = "node",
                        Arguments = "--version",
                        UseShellExecute = false,
                        RedirectStandardOutput = true,
                        CreateNoWindow = true
                    }
                };
                process.Start();
                process.WaitForExit();
                return process.ExitCode == 0;
            }
            catch
            {
                return false;
            }
        }

        private static void StartServer(string appDir)
        {
            try
            {
                serverProcess = new Process
                {
                    StartInfo = new ProcessStartInfo
                    {
                        FileName = "node",
                        Arguments = "server.js",
                        WorkingDirectory = appDir,
                        UseShellExecute = false,
                        CreateNoWindow = true,
                        WindowStyle = ProcessWindowStyle.Hidden
                    }
                };
                serverProcess.Start();
            }
            catch (Exception ex)
            {
                MessageBox.Show($"Erreur lors du démarrage du serveur:\n{ex.Message}", 
                    "TelecomStock Pro", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private static void StopServer()
        {
            try
            {
                if (serverProcess != null && !serverProcess.HasExited)
                {
                    serverProcess.Kill();
                    serverProcess.WaitForExit(5000);
                }
            }
            catch { }
        }

        private static void CreateTrayIcon()
        {
            trayIcon = new NotifyIcon
            {
                Icon = SystemIcons.Application,
                Text = "TelecomStock Pro\nhttp://localhost:3002",
                Visible = true
            };

            var contextMenu = new ContextMenuStrip();
            contextMenu.Items.Add("Ouvrir le navigateur", null, (s, e) => Process.Start("http://localhost:3002"));
            contextMenu.Items.Add("-");
            contextMenu.Items.Add("Quitter", null, (s, e) => Application.Exit());

            trayIcon.ContextMenuStrip = contextMenu;
            trayIcon.DoubleClick += (s, e) => Process.Start("http://localhost:3002");
        }
    }
}