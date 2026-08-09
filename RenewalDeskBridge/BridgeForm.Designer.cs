namespace RenewalDeskBridge
{
    partial class BridgeForm
    {
        private System.ComponentModel.IContainer components = null;

        protected override void Dispose(bool disposing)
        {
            if (disposing && (components != null)) components.Dispose();
            base.Dispose(disposing);
        }

        // Designer-generated controls
        private System.Windows.Forms.Label lblTitle;
        private System.Windows.Forms.GroupBox grpDevice;
        private System.Windows.Forms.Label lblDeviceIp;
        private System.Windows.Forms.TextBox txtDeviceIp;
        private System.Windows.Forms.Label lblDevicePort;
        private System.Windows.Forms.TextBox txtDevicePort;
        private System.Windows.Forms.Label lblCommPassword;
        private System.Windows.Forms.TextBox txtCommPassword;
        private System.Windows.Forms.Button btnConnect;
        private System.Windows.Forms.Label lblDeviceStatus;

        private System.Windows.Forms.GroupBox grpApi;
        private System.Windows.Forms.Label lblGymId;
        private System.Windows.Forms.TextBox txtGymId;
        private System.Windows.Forms.Label lblApiBaseUrl;
        private System.Windows.Forms.TextBox txtApiBaseUrl;
        private System.Windows.Forms.Label lblApiKey;
        private System.Windows.Forms.TextBox txtApiKey;
        private System.Windows.Forms.Label lblApiStatus;

        private System.Windows.Forms.GroupBox grpTests;
        private System.Windows.Forms.Label lblUnlockDelay;
        private System.Windows.Forms.TextBox txtUnlockDelay;
        private System.Windows.Forms.Button btnTestUnlock;
        private System.Windows.Forms.Label lblTestEnrollNumber;
        private System.Windows.Forms.TextBox txtTestEnrollNumber;
        private System.Windows.Forms.Label lblTestMemberName;
        private System.Windows.Forms.TextBox txtTestMemberName;
        private System.Windows.Forms.Button btnTestEnable;
        private System.Windows.Forms.Button btnTestDisable;

        private System.Windows.Forms.Label lblLog;
        private System.Windows.Forms.TextBox txtLog;

        private void InitializeComponent()
        {
            this.lblTitle = new System.Windows.Forms.Label();

            this.grpDevice = new System.Windows.Forms.GroupBox();
            this.lblDeviceIp = new System.Windows.Forms.Label();
            this.txtDeviceIp = new System.Windows.Forms.TextBox();
            this.lblDevicePort = new System.Windows.Forms.Label();
            this.txtDevicePort = new System.Windows.Forms.TextBox();
            this.lblCommPassword = new System.Windows.Forms.Label();
            this.txtCommPassword = new System.Windows.Forms.TextBox();
            this.btnConnect = new System.Windows.Forms.Button();
            this.lblDeviceStatus = new System.Windows.Forms.Label();

            this.grpApi = new System.Windows.Forms.GroupBox();
            this.lblGymId = new System.Windows.Forms.Label();
            this.txtGymId = new System.Windows.Forms.TextBox();
            this.lblApiBaseUrl = new System.Windows.Forms.Label();
            this.txtApiBaseUrl = new System.Windows.Forms.TextBox();
            this.lblApiKey = new System.Windows.Forms.Label();
            this.txtApiKey = new System.Windows.Forms.TextBox();
            this.lblApiStatus = new System.Windows.Forms.Label();

            this.grpTests = new System.Windows.Forms.GroupBox();
            this.lblUnlockDelay = new System.Windows.Forms.Label();
            this.txtUnlockDelay = new System.Windows.Forms.TextBox();
            this.btnTestUnlock = new System.Windows.Forms.Button();
            this.lblTestEnrollNumber = new System.Windows.Forms.Label();
            this.txtTestEnrollNumber = new System.Windows.Forms.TextBox();
            this.lblTestMemberName = new System.Windows.Forms.Label();
            this.txtTestMemberName = new System.Windows.Forms.TextBox();
            this.btnTestEnable = new System.Windows.Forms.Button();
            this.btnTestDisable = new System.Windows.Forms.Button();

            this.lblLog = new System.Windows.Forms.Label();
            this.txtLog = new System.Windows.Forms.TextBox();

            this.SuspendLayout();

            // lblTitle
            this.lblTitle.Text = "Renewal Desk Bridge (Dev/Test)";
            this.lblTitle.Font = new System.Drawing.Font("Segoe UI", 14F, System.Drawing.FontStyle.Bold);
            this.lblTitle.Location = new System.Drawing.Point(20, 15);
            this.lblTitle.Size = new System.Drawing.Size(500, 30);

            // grpDevice
            this.grpDevice.Text = "1. Device Connection";
            this.grpDevice.Location = new System.Drawing.Point(20, 55);
            this.grpDevice.Size = new System.Drawing.Size(480, 190);

            this.lblDeviceIp.Text = "Device IP:";
            this.lblDeviceIp.Location = new System.Drawing.Point(15, 30);
            this.lblDeviceIp.Size = new System.Drawing.Size(90, 20);
            this.txtDeviceIp.Location = new System.Drawing.Point(115, 27);
            this.txtDeviceIp.Size = new System.Drawing.Size(160, 22);
            this.txtDeviceIp.Text = "192.168.1.50";

            this.lblDevicePort.Text = "Port:";
            this.lblDevicePort.Location = new System.Drawing.Point(290, 30);
            this.lblDevicePort.Size = new System.Drawing.Size(40, 20);
            this.txtDevicePort.Location = new System.Drawing.Point(335, 27);
            this.txtDevicePort.Size = new System.Drawing.Size(60, 22);
            this.txtDevicePort.Text = "4370";

            this.lblCommPassword.Text = "Comm Password (if set):";
            this.lblCommPassword.Location = new System.Drawing.Point(15, 60);
            this.lblCommPassword.Size = new System.Drawing.Size(160, 20);
            this.txtCommPassword.Location = new System.Drawing.Point(180, 57);
            this.txtCommPassword.Size = new System.Drawing.Size(150, 22);
            this.txtCommPassword.UseSystemPasswordChar = true;

            this.btnConnect.Text = "Connect";
            this.btnConnect.Location = new System.Drawing.Point(15, 95);
            this.btnConnect.Size = new System.Drawing.Size(120, 32);
            this.btnConnect.Click += new System.EventHandler(this.btnConnect_Click);

            this.lblDeviceStatus.Text = "Device: Not connected";
            this.lblDeviceStatus.ForeColor = System.Drawing.Color.DarkRed;
            this.lblDeviceStatus.Location = new System.Drawing.Point(150, 102);
            this.lblDeviceStatus.Size = new System.Drawing.Size(300, 20);
            this.lblDeviceStatus.Font = new System.Drawing.Font("Segoe UI", 9F, System.Drawing.FontStyle.Bold);

            this.grpDevice.Controls.Add(this.lblDeviceIp);
            this.grpDevice.Controls.Add(this.txtDeviceIp);
            this.grpDevice.Controls.Add(this.lblDevicePort);
            this.grpDevice.Controls.Add(this.txtDevicePort);
            this.grpDevice.Controls.Add(this.lblCommPassword);
            this.grpDevice.Controls.Add(this.txtCommPassword);
            this.grpDevice.Controls.Add(this.btnConnect);
            this.grpDevice.Controls.Add(this.lblDeviceStatus);

            // grpApi
            this.grpApi.Text = "2. Renewal Desk Connection";
            this.grpApi.Location = new System.Drawing.Point(520, 55);
            this.grpApi.Size = new System.Drawing.Size(460, 190);

            this.lblGymId.Text = "Gym ID:";
            this.lblGymId.Location = new System.Drawing.Point(15, 30);
            this.lblGymId.Size = new System.Drawing.Size(90, 20);
            this.txtGymId.Location = new System.Drawing.Point(115, 27);
            this.txtGymId.Size = new System.Drawing.Size(200, 22);

            this.lblApiBaseUrl.Text = "API URL:";
            this.lblApiBaseUrl.Location = new System.Drawing.Point(15, 60);
            this.lblApiBaseUrl.Size = new System.Drawing.Size(90, 20);
            this.txtApiBaseUrl.Location = new System.Drawing.Point(115, 57);
            this.txtApiBaseUrl.Size = new System.Drawing.Size(320, 22);
            this.txtApiBaseUrl.Text = "http://localhost:5080";

            this.lblApiKey.Text = "API Key:";
            this.lblApiKey.Location = new System.Drawing.Point(15, 90);
            this.lblApiKey.Size = new System.Drawing.Size(90, 20);
            this.txtApiKey.Location = new System.Drawing.Point(115, 87);
            this.txtApiKey.Size = new System.Drawing.Size(320, 22);
            this.txtApiKey.UseSystemPasswordChar = true;

            this.lblApiStatus.Text = "Renewal Desk: Not connected";
            this.lblApiStatus.ForeColor = System.Drawing.Color.DarkRed;
            this.lblApiStatus.Location = new System.Drawing.Point(15, 125);
            this.lblApiStatus.Size = new System.Drawing.Size(320, 20);
            this.lblApiStatus.Font = new System.Drawing.Font("Segoe UI", 9F, System.Drawing.FontStyle.Bold);

            this.grpApi.Controls.Add(this.lblGymId);
            this.grpApi.Controls.Add(this.txtGymId);
            this.grpApi.Controls.Add(this.lblApiBaseUrl);
            this.grpApi.Controls.Add(this.txtApiBaseUrl);
            this.grpApi.Controls.Add(this.lblApiKey);
            this.grpApi.Controls.Add(this.txtApiKey);
            this.grpApi.Controls.Add(this.lblApiStatus);

            // grpTests
            this.grpTests.Text = "3. Manual Tests (prove it works before trusting it)";
            this.grpTests.Location = new System.Drawing.Point(20, 255);
            this.grpTests.Size = new System.Drawing.Size(960, 130);

            this.lblUnlockDelay.Text = "Unlock delay (sec):";
            this.lblUnlockDelay.Location = new System.Drawing.Point(15, 30);
            this.lblUnlockDelay.Size = new System.Drawing.Size(120, 20);
            this.txtUnlockDelay.Location = new System.Drawing.Point(140, 27);
            this.txtUnlockDelay.Size = new System.Drawing.Size(50, 22);
            this.txtUnlockDelay.Text = "5";

            this.btnTestUnlock.Text = "Test Unlock Door";
            this.btnTestUnlock.Location = new System.Drawing.Point(200, 25);
            this.btnTestUnlock.Size = new System.Drawing.Size(140, 30);
            this.btnTestUnlock.Click += new System.EventHandler(this.btnTestUnlock_Click);

            this.lblTestEnrollNumber.Text = "Test Enroll Number:";
            this.lblTestEnrollNumber.Location = new System.Drawing.Point(15, 70);
            this.lblTestEnrollNumber.Size = new System.Drawing.Size(120, 20);
            this.txtTestEnrollNumber.Location = new System.Drawing.Point(140, 67);
            this.txtTestEnrollNumber.Size = new System.Drawing.Size(100, 22);

            this.lblTestMemberName.Text = "Name (if new):";
            this.lblTestMemberName.Location = new System.Drawing.Point(250, 70);
            this.lblTestMemberName.Size = new System.Drawing.Size(100, 20);
            this.txtTestMemberName.Location = new System.Drawing.Point(355, 67);
            this.txtTestMemberName.Size = new System.Drawing.Size(140, 22);

            this.btnTestEnable.Text = "Set ENABLED";
            this.btnTestEnable.Location = new System.Drawing.Point(510, 65);
            this.btnTestEnable.Size = new System.Drawing.Size(110, 30);
            this.btnTestEnable.BackColor = System.Drawing.Color.LightGreen;
            this.btnTestEnable.Click += new System.EventHandler(this.btnTestEnable_Click);

            this.btnTestDisable.Text = "Set DISABLED";
            this.btnTestDisable.Location = new System.Drawing.Point(630, 65);
            this.btnTestDisable.Size = new System.Drawing.Size(110, 30);
            this.btnTestDisable.BackColor = System.Drawing.Color.LightCoral;
            this.btnTestDisable.Click += new System.EventHandler(this.btnTestDisable_Click);

            this.grpTests.Controls.Add(this.lblUnlockDelay);
            this.grpTests.Controls.Add(this.txtUnlockDelay);
            this.grpTests.Controls.Add(this.btnTestUnlock);
            this.grpTests.Controls.Add(this.lblTestEnrollNumber);
            this.grpTests.Controls.Add(this.txtTestEnrollNumber);
            this.grpTests.Controls.Add(this.lblTestMemberName);
            this.grpTests.Controls.Add(this.txtTestMemberName);
            this.grpTests.Controls.Add(this.btnTestEnable);
            this.grpTests.Controls.Add(this.btnTestDisable);

            // Log
            this.lblLog.Text = "Live Log:";
            this.lblLog.Location = new System.Drawing.Point(20, 395);
            this.lblLog.Size = new System.Drawing.Size(200, 20);
            this.lblLog.Font = new System.Drawing.Font("Segoe UI", 9F, System.Drawing.FontStyle.Bold);

            this.txtLog.Multiline = true;
            this.txtLog.ScrollBars = System.Windows.Forms.ScrollBars.Vertical;
            this.txtLog.Location = new System.Drawing.Point(20, 420);
            this.txtLog.Size = new System.Drawing.Size(960, 260);
            this.txtLog.ReadOnly = true;
            this.txtLog.Font = new System.Drawing.Font("Consolas", 9F);
            this.txtLog.BackColor = System.Drawing.Color.Black;
            this.txtLog.ForeColor = System.Drawing.Color.LightGreen;

            // BridgeForm
            this.ClientSize = new System.Drawing.Size(1000, 700);
            this.Text = "Renewal Desk Bridge";
            this.FormClosing += new System.Windows.Forms.FormClosingEventHandler(this.BridgeForm_FormClosing);

            this.Controls.Add(this.lblTitle);
            this.Controls.Add(this.grpDevice);
            this.Controls.Add(this.grpApi);
            this.Controls.Add(this.grpTests);
            this.Controls.Add(this.lblLog);
            this.Controls.Add(this.txtLog);

            this.ResumeLayout(false);
        }
    }
}
