package io.github.hafijbge.docscan;

import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;

import androidx.core.content.FileProvider;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;

/**
 * Native side of src/platform.ts, exposed to the page as window.DocScanHost.
 * Every method returns "ok:<info>" or "error:<message>".
 *
 * Files live in one folder: Documents/DocScan through MediaStore by default
 * (no permission needed, but only files this app wrote are visible), or a
 * folder the user picked with the system folder picker (every file visible).
 */
final class Host {

    static final String PREFS = "docscan";
    static final String KEY_TREE = "folderTree";
    private static final String MEDIA_PATH = "Documents/DocScan/";
    private static final String PDF = "application/pdf";

    private final MainActivity activity;

    Host(MainActivity activity) {
        this.activity = activity;
    }

    /** The picked folder tree, or null for the default MediaStore folder. */
    private Uri tree() {
        String s = activity.getSharedPreferences(PREFS, 0).getString(KEY_TREE, null);
        return s == null ? null : Uri.parse(s);
    }

    private ContentResolver resolver() {
        return activity.getContentResolver();
    }

    @JavascriptInterface
    public String folderLabel() {
        Uri tree = tree();
        if (tree == null) return "ok:Documents/DocScan";
        String id = DocumentsContract.getTreeDocumentId(tree);
        // "primary:Documents/DocScan" -> "Documents/DocScan"
        int colon = id.indexOf(':');
        return "ok:" + (colon >= 0 ? id.substring(colon + 1) : id);
    }

    /** Opens the system folder picker; the result arrives in window.__docscanFolderPicked. */
    @JavascriptInterface
    public String chooseFolder() {
        activity.runOnUiThread(activity::pickFolder);
        return "ok:";
    }

    /** Back to the default Documents/DocScan folder. */
    @JavascriptInterface
    public String resetFolder() {
        activity.getSharedPreferences(PREFS, 0).edit().remove(KEY_TREE).apply();
        return "ok:";
    }

    /** JSON array of {name, size, modified} for the PDFs in the folder. */
    @JavascriptInterface
    public String listPdfs() {
        try {
            JSONArray out = new JSONArray();
            Uri tree = tree();
            if (tree != null) {
                Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
                String[] cols = {
                    DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                    DocumentsContract.Document.COLUMN_SIZE,
                    DocumentsContract.Document.COLUMN_LAST_MODIFIED,
                    DocumentsContract.Document.COLUMN_MIME_TYPE,
                };
                try (Cursor c = resolver().query(children, cols, null, null, null)) {
                    while (c != null && c.moveToNext()) {
                        String name = c.getString(0);
                        if (name == null || !(PDF.equals(c.getString(3)) || name.toLowerCase().endsWith(".pdf"))) continue;
                        out.put(new JSONObject().put("name", name).put("size", c.getLong(1)).put("modified", c.getLong(2)));
                    }
                }
            } else {
                String[] cols = {
                    MediaStore.MediaColumns.DISPLAY_NAME,
                    MediaStore.MediaColumns.SIZE,
                    MediaStore.MediaColumns.DATE_MODIFIED,
                };
                try (Cursor c = resolver().query(mediaFiles(), cols, MediaStore.MediaColumns.RELATIVE_PATH + "=?", new String[] { MEDIA_PATH }, null)) {
                    while (c != null && c.moveToNext()) {
                        String name = c.getString(0);
                        if (name == null || !name.toLowerCase().endsWith(".pdf")) continue;
                        // DATE_MODIFIED is in seconds.
                        out.put(new JSONObject().put("name", name).put("size", c.getLong(1)).put("modified", c.getLong(2) * 1000));
                    }
                }
            }
            return "ok:" + out;
        } catch (Exception e) {
            return "error:" + e.getMessage();
        }
    }

    /** Base64 of the file, or of its first maxBytes bytes when maxBytes > 0. */
    @JavascriptInterface
    public String readFile(String name, int maxBytes) {
        try {
            Uri uri = find(name);
            if (uri == null) return "error:" + name + " not found";
            try (InputStream in = resolver().openInputStream(uri)) {
                if (in == null) return "error:Cannot open " + name;
                ByteArrayOutputStream buf = new ByteArrayOutputStream();
                byte[] chunk = new byte[65536];
                int limit = maxBytes > 0 ? maxBytes : Integer.MAX_VALUE;
                int n;
                while (buf.size() < limit && (n = in.read(chunk, 0, Math.min(chunk.length, limit - buf.size()))) > 0) buf.write(chunk, 0, n);
                return "ok:" + Base64.encodeToString(buf.toByteArray(), Base64.NO_WRAP);
            }
        } catch (Exception e) {
            return "error:" + e.getMessage();
        }
    }

    /** Writes the file; "error:exists" when it is there and overwrite is false. */
    @JavascriptInterface
    public String writeFile(String name, String mime, String base64, boolean overwrite) {
        try {
            String clean = safeName(name);
            byte[] data = Base64.decode(base64, Base64.DEFAULT);
            Uri uri = find(clean);
            if (uri != null && !overwrite) return "error:exists";
            if (uri != null) {
                write(uri, data, "wt");
                return "ok:" + clean;
            }
            Uri tree = tree();
            if (tree != null) {
                Uri dir = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
                uri = DocumentsContract.createDocument(resolver(), dir, mime, clean);
                if (uri == null) return "error:Cannot create " + clean;
                write(uri, data, "w");
                return "ok:" + clean;
            }
            ContentValues values = new ContentValues();
            values.put(MediaStore.MediaColumns.DISPLAY_NAME, clean);
            values.put(MediaStore.MediaColumns.MIME_TYPE, mime);
            values.put(MediaStore.MediaColumns.RELATIVE_PATH, MEDIA_PATH);
            values.put(MediaStore.MediaColumns.IS_PENDING, 1);
            uri = resolver().insert(mediaFiles(), values);
            if (uri == null) return "error:Cannot create the file in Documents";
            try {
                write(uri, data, "w");
            } catch (IOException e) {
                resolver().delete(uri, null, null);
                throw e;
            }
            values.clear();
            values.put(MediaStore.MediaColumns.IS_PENDING, 0);
            resolver().update(uri, values, null, null);
            return "ok:" + clean;
        } catch (Exception e) {
            return "error:" + e.getMessage();
        }
    }

    @JavascriptInterface
    public String fileExists(String name) {
        try {
            return "ok:" + (find(safeName(name)) != null);
        } catch (Exception e) {
            return "error:" + e.getMessage();
        }
    }

    @JavascriptInterface
    public String deleteFile(String name) {
        try {
            Uri uri = find(name);
            if (uri == null) return "ok:";
            if (tree() != null) DocumentsContract.deleteDocument(resolver(), uri);
            else resolver().delete(uri, null, null);
            return "ok:";
        } catch (Exception e) {
            return "error:" + e.getMessage();
        }
    }

    @JavascriptInterface
    public String renameFile(String from, String to) {
        try {
            String clean = safeName(to);
            if (find(clean) != null) return "error:" + clean + " already exists";
            Uri uri = find(from);
            if (uri == null) return "error:" + from + " not found";
            if (tree() != null) {
                if (DocumentsContract.renameDocument(resolver(), uri, clean) == null) return "error:Cannot rename";
            } else {
                ContentValues values = new ContentValues();
                values.put(MediaStore.MediaColumns.DISPLAY_NAME, clean);
                resolver().update(uri, values, null, null);
            }
            return "ok:";
        } catch (Exception e) {
            return "error:" + e.getMessage();
        }
    }

    /** Opens the file in a PDF viewer (or image viewer for JPGs). */
    @JavascriptInterface
    public String openFile(String name) {
        try {
            Uri uri = find(name);
            if (uri == null) return "error:" + name + " not found";
            String mime = name.toLowerCase().endsWith(".pdf") ? PDF : "image/jpeg";
            Intent view = new Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, mime)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            activity.runOnUiThread(() -> {
                try {
                    activity.startActivity(Intent.createChooser(view, null));
                } catch (RuntimeException e) {
                    activity.toastError("No app can open " + name);
                }
            });
            return "ok:";
        } catch (Exception e) {
            return "error:" + e.getMessage();
        }
    }

    /** Shares a file from the folder with the system share sheet. */
    @JavascriptInterface
    public String shareSaved(String name) {
        try {
            Uri uri = find(name);
            if (uri == null) return "error:" + name + " not found";
            share(uri, name.toLowerCase().endsWith(".pdf") ? PDF : "image/jpeg");
            return "ok:";
        } catch (Exception e) {
            return "error:" + e.getMessage();
        }
    }

    /** Writes the file to the app cache and opens the system share sheet for it. */
    @JavascriptInterface
    public String shareFile(String name, String mime, String base64) {
        try {
            byte[] data = Base64.decode(base64, Base64.DEFAULT);
            File dir = new File(activity.getCacheDir(), "shared");
            if (!dir.isDirectory() && !dir.mkdirs()) return "error:Cannot create the share folder";
            File file = new File(dir, safeName(name));
            try (FileOutputStream out = new FileOutputStream(file)) {
                out.write(data);
            }
            share(FileProvider.getUriForFile(activity, activity.getPackageName() + ".files", file), mime);
            return "ok:";
        } catch (Exception e) {
            return "error:" + e.getMessage();
        }
    }

    @JavascriptInterface
    public String openUrl(String url) {
        if (url == null || !url.startsWith("https://")) return "error:only https links can be opened";
        activity.runOnUiThread(() -> {
            try {
                activity.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
            } catch (RuntimeException e) {
                activity.toastError("No browser found");
            }
        });
        return "ok:";
    }

    /** Colours the status bar and navigation bar to match the page. */
    @JavascriptInterface
    public String setSystemBars(String top, String bottom, boolean lightBottom) {
        activity.runOnUiThread(() -> activity.setBars(top, bottom, lightBottom));
        return "ok:";
    }

    /**
     * Starts a one-shot loopback HTTP listener for the Google sign-in redirect
     * and returns its port. The query string of the redirect is passed to
     * window.__docscanOAuth(query), or null after five minutes.
     */
    @JavascriptInterface
    public String oauthListen() {
        try {
            ServerSocket server = new ServerSocket(0, 4, java.net.InetAddress.getByName("127.0.0.1"));
            server.setSoTimeout(300_000);
            Thread t = new Thread(() -> {
                String query = null;
                try (ServerSocket s = server) {
                    while (query == null) {
                        try (Socket client = s.accept()) {
                            query = answerRedirect(client);
                        }
                    }
                } catch (SocketTimeoutException ignored) {
                    // no sign-in within five minutes
                } catch (IOException ignored) {
                    // listener closed
                }
                activity.deliverOAuth(query);
            }, "oauth-loopback");
            t.setDaemon(true);
            t.start();
            return "ok:" + server.getLocalPort();
        } catch (IOException e) {
            return "error:" + e.getMessage();
        }
    }

    private static String answerRedirect(Socket client) throws IOException {
        client.setSoTimeout(5000);
        byte[] buf = new byte[8192];
        int n = client.getInputStream().read(buf);
        if (n <= 0) return null;
        String line = new String(buf, 0, n, StandardCharsets.ISO_8859_1).split("\r\n", 2)[0];
        String[] parts = line.split(" ");
        String target = parts.length > 1 ? parts[1] : "";
        int q = target.indexOf('?');
        String query = q >= 0 ? target.substring(q + 1) : null;
        String body = query == null ? "" : "<!doctype html><meta charset=utf-8><meta name=viewport content=\"width=device-width\"><title>DocScan</title>"
            + "<body style=\"font-family:sans-serif;text-align:center;padding:48px\"><h2>Signed in</h2><p>You can go back to DocScan now.</p>";
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        String head = "HTTP/1.1 " + (query == null ? "404 Not Found" : "200 OK") + "\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: "
            + bytes.length + "\r\nConnection: close\r\n\r\n";
        OutputStream out = client.getOutputStream();
        out.write(head.getBytes(StandardCharsets.ISO_8859_1));
        out.write(bytes);
        out.flush();
        return query;
    }

    private void share(Uri uri, String mime) {
        Intent send = new Intent(Intent.ACTION_SEND)
            .setType(mime)
            .putExtra(Intent.EXTRA_STREAM, uri)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        activity.runOnUiThread(() -> activity.startActivity(Intent.createChooser(send, null)));
    }

    private void write(Uri uri, byte[] data, String mode) throws IOException {
        try (OutputStream out = resolver().openOutputStream(uri, mode)) {
            if (out == null) throw new IOException("Cannot open the file for writing");
            out.write(data);
        }
    }

    /** The content URI of a file in the folder, or null. */
    private Uri find(String name) {
        Uri tree = tree();
        if (tree != null) {
            Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
            String[] cols = { DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME };
            // Document providers ignore selection arguments, so filter here.
            try (Cursor c = resolver().query(children, cols, null, null, null)) {
                while (c != null && c.moveToNext()) {
                    if (name.equals(c.getString(1))) return DocumentsContract.buildDocumentUriUsingTree(tree, c.getString(0));
                }
            }
            return null;
        }
        String[] cols = { MediaStore.MediaColumns._ID };
        String where = MediaStore.MediaColumns.RELATIVE_PATH + "=? AND " + MediaStore.MediaColumns.DISPLAY_NAME + "=?";
        try (Cursor c = resolver().query(mediaFiles(), cols, where, new String[] { MEDIA_PATH, name }, null)) {
            if (c != null && c.moveToFirst()) return ContentUris.withAppendedId(mediaFiles(), c.getLong(0));
        }
        return null;
    }

    private static Uri mediaFiles() {
        return MediaStore.Files.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
    }

    private static String safeName(String name) {
        String clean = name == null ? "" : name.replaceAll("[\\\\/:*?\"<>|\\x00-\\x1f]+", "_").trim();
        return clean.isEmpty() ? "scan" : clean;
    }
}
