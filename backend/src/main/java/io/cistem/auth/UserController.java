package io.cistem.auth;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** Who am I: the browser asks on load to know whether it's signed in. */
@RestController
public class UserController {

    private final CurrentUser user;
    private final UserRepository users;

    public UserController(CurrentUser user, UserRepository users) {
        this.user = user;
        this.users = users;
    }

    /** 200 with the profile, or 401 when signed out (this endpoint is public, so it answers itself). */
    @GetMapping("/api/me")
    public ResponseEntity<User.Profile> me() {
        return user.find().flatMap(users::find)
                .map(u -> ResponseEntity.ok(u.profile()))
                .orElseGet(() -> ResponseEntity.status(HttpStatus.UNAUTHORIZED).build());
    }
}
