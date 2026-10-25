import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../features/auth/auth_controller.dart';
import '../../features/auth/auth_screens.dart';
import '../../features/clients/client_screens.dart';
import '../../features/dashboard/dashboard_screens.dart';
import '../../features/followups/followup_screens.dart';
import '../../features/home/home_shell.dart';
import '../../features/matches/matches_screen.dart';
import '../../features/notifications/notifications_screen.dart';
import '../../features/owners/owner_screens.dart';
import '../../features/properties/location_picker.dart';
import '../../features/properties/property_screens.dart';
import '../../features/settings/settings_screens.dart';
import '../../features/settings/sync_screen.dart';

/// Bridges auth state to GoRouter so redirects re-run when it changes.
class _AuthListenable extends ChangeNotifier {
  _AuthListenable(Ref ref) {
    ref.listen<AuthState>(authProvider, (_, _) => notifyListeners());
  }
}

final rootNavigatorKey = GlobalKey<NavigatorState>();

/// Notification deep links point at web-style paths; map them to app routes.
String appRouteFor(String deepLink) {
  if (deepLink.startsWith('/matches/')) return '/matches';
  return deepLink;
}

final routerProvider = Provider<GoRouter>((ref) {
  final listenable = _AuthListenable(ref);
  return GoRouter(
    navigatorKey: rootNavigatorKey,
    initialLocation: '/splash',
    refreshListenable: listenable,
    redirect: (context, state) {
      final auth = ref.read(authProvider);
      final loc = state.uri.path;
      const public = {'/login', '/register', '/forgot-password'};
      switch (auth.status) {
        case AuthStatus.unknown:
          return loc == '/splash' ? null : '/splash';
        case AuthStatus.signedOut:
          return public.contains(loc) ? null : '/login';
        case AuthStatus.restoring:
          return loc == '/restoring' ? null : '/restoring';
        case AuthStatus.locked:
          return loc == '/lock' ? null : '/lock';
        case AuthStatus.signedIn:
          if (auth.mustChangePassword) return loc == '/change-password' ? null : '/change-password';
          if (public.contains(loc) || const {'/splash', '/restoring', '/lock', '/change-password'}.contains(loc)) return '/my-day';
          return null;
      }
    },
    routes: [
      GoRoute(path: '/splash', builder: (_, _) => const SplashScreen()),
      GoRoute(path: '/login', builder: (_, _) => const LoginScreen()),
      GoRoute(path: '/register', builder: (_, _) => const RegisterScreen()),
      GoRoute(path: '/forgot-password', builder: (_, _) => const ForgotPasswordScreen()),
      GoRoute(path: '/change-password', builder: (_, _) => const ChangeTemporaryPasswordScreen()),
      GoRoute(path: '/restoring', builder: (_, _) => const RestoringScreen()),
      GoRoute(path: '/lock', builder: (_, _) => const LockScreen()),
      StatefulShellRoute.indexedStack(
        builder: (context, state, shell) => HomeShell(shell: shell),
        branches: [
          StatefulShellBranch(routes: [GoRoute(path: '/my-day', builder: (_, _) => const MyDayScreen())]),
          StatefulShellBranch(routes: [GoRoute(path: '/clients', builder: (_, _) => const ClientsScreen())]),
          StatefulShellBranch(routes: [GoRoute(path: '/properties', builder: (_, _) => const PropertiesScreen())]),
          StatefulShellBranch(routes: [GoRoute(path: '/matches', builder: (_, _) => const MatchesScreen())]),
          StatefulShellBranch(routes: [GoRoute(path: '/more', builder: (_, _) => const MoreScreen())]),
        ],
      ),
      GoRoute(path: '/dashboard', builder: (_, _) => const DashboardScreen()),
      GoRoute(path: '/clients/new', builder: (_, _) => const ClientFormScreen()),
      GoRoute(path: '/clients/:id', builder: (_, s) => ClientDetailScreen(id: s.pathParameters['id']!)),
      GoRoute(path: '/clients/:id/edit', builder: (_, s) => ClientFormScreen(id: s.pathParameters['id'])),
      GoRoute(path: '/properties/new', builder: (_, _) => const PropertyFormScreen()),
      GoRoute(path: '/properties/:id', builder: (_, s) => PropertyDetailScreen(id: s.pathParameters['id']!)),
      GoRoute(path: '/properties/:id/edit', builder: (_, s) => PropertyFormScreen(id: s.pathParameters['id'])),
      GoRoute(path: '/owners', builder: (_, _) => const OwnersScreen()),
      GoRoute(path: '/owners/new', builder: (_, _) => const OwnerFormScreen()),
      GoRoute(path: '/owners/:id', builder: (_, s) => OwnerDetailScreen(id: s.pathParameters['id']!)),
      GoRoute(path: '/owners/:id/edit', builder: (_, s) => OwnerFormScreen(id: s.pathParameters['id'])),
      GoRoute(path: '/followups', builder: (_, _) => const FollowUpsScreen()),
      GoRoute(
        path: '/followups/new',
        builder: (_, s) => FollowUpFormScreen(clientId: s.uri.queryParameters['clientId'], propertyId: s.uri.queryParameters['propertyId']),
      ),
      GoRoute(path: '/followups/:id', builder: (_, s) => FollowUpDetailScreen(id: s.pathParameters['id']!)),
      GoRoute(path: '/notifications', builder: (_, _) => const NotificationsScreen()),
      GoRoute(path: '/settings', builder: (_, _) => const SettingsScreen()),
      GoRoute(path: '/sync', builder: (_, _) => const SyncScreen()),
      GoRoute(path: '/pick-location', builder: (_, s) => LocationPickerScreen(initial: s.extra as ({double lat, double lng})?)),
    ],
  );
});
