package io.cistem.diagram;

import java.security.SecureRandom;
import java.util.Base64;

/** Unguessable tokens for read-only share links (diagrams and projects). */
public final class ShareTokens {

    private static final SecureRandom RANDOM = new SecureRandom();

    private ShareTokens() {}

    /** 18 random bytes, url-safe base64 without padding (24 characters). */
    public static String next() {
        byte[] b = new byte[18];
        RANDOM.nextBytes(b);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(b);
    }
}
